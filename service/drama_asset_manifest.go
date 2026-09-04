package service

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// 项目资产清单（漫剧资产 manifest）：D 盘项目文件夹为唯一事实源（发布区），
// 浏览器 store 为工作区、条目 history/ 为历史区，三区分离不复制第二份状态。
// 项目文件夹约定：<根目录>/<项目名>/资产清单.json；资产/<分类>/<名称>/；分集/epNN/；设定/（故事圣经、提示词资产等项目级设定文档）。
var AssetCategories = []string{"角色", "场景", "道具", "生物", "特效", "图形", "声音", "风格"}

var AssetStatuses = []string{"待产出", "制作中", "待审核", "需修改", "已确认", "已归档"}

func nowStamp() string { return time.Now().Format("2006-01-02 15:04:05") }

// ListAssetProjects 列出本地媒体根目录下全部项目文件夹名（供资产绑定选择，含尚未建清单的项目）。
func ListAssetProjects() ([]string, error) {
	entries, err := os.ReadDir(localMediaBaseDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	return names, nil
}

func assetProjectDir(title string) (string, error) {
	folder := sanitizeFolderName(title)
	if folder == "" {
		return "", errors.New("项目名为空")
	}
	return filepath.Join(localMediaBaseDir(), folder), nil
}

// assetRelPath 校验清单内相对路径：只允许 资产/、分集/ 与 设定/ 三棵子树，禁越界。
func assetRelPath(rel string) (string, error) {
	p := filepath.ToSlash(strings.TrimSpace(rel))
	if p == "" || strings.Contains(p, "..") {
		return "", errors.New("非法路径")
	}
	if !strings.HasPrefix(p, "资产/") && !strings.HasPrefix(p, "分集/") && !strings.HasPrefix(p, "设定/") {
		return "", errors.New("路径必须位于 资产/、分集/ 或 设定/ 下")
	}
	return filepath.FromSlash(p), nil
}

func entryString(entry map[string]any, key string) string {
	v, _ := entry[key].(string)
	return strings.TrimSpace(v)
}

func entryList(entry map[string]any, key string) []any {
	v, _ := entry[key].([]any)
	return v
}

func LoadAssetManifest(title string) (map[string]any, error) {
	dir, err := assetProjectDir(title)
	if err != nil {
		return nil, err
	}
	empty := map[string]any{"schema": 1, "项目": sanitizeFolderName(title), "更新": "", "条目": []any{}}
	data, err := os.ReadFile(filepath.Join(dir, "资产清单.json"))
	if err != nil {
		if os.IsNotExist(err) {
			return empty, nil
		}
		return nil, err
	}
	var manifest map[string]any
	// 剥离 UTF-8 BOM 后再解析：清单是可手工编辑的 JSON，Windows PowerShell 的 Set-Content -Encoding UTF8
	// 与记事本都会写 BOM，Go 的 json.Unmarshal 不接受，否则整个清单读不出来（与 readQoderMcpJSON 同一处理）
	if err := json.Unmarshal(bytes.TrimPrefix(data, utf8BOM), &manifest); err != nil {
		return nil, errors.New("资产清单.json 解析失败：" + err.Error())
	}
	if _, ok := manifest["条目"]; !ok {
		manifest["条目"] = []any{}
	}
	return manifest, nil
}

func saveAssetManifest(title string, manifest map[string]any) error {
	dir, err := assetProjectDir(title)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	manifest["项目"] = sanitizeFolderName(title)
	manifest["更新"] = nowStamp()
	if _, ok := manifest["schema"]; !ok {
		manifest["schema"] = 1
	}
	data, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(dir, "资产清单.json"), data, 0o644)
}

func manifestEntries(manifest map[string]any) []map[string]any {
	raw, _ := manifest["条目"].([]any)
	entries := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if entry, ok := item.(map[string]any); ok {
			entries = append(entries, entry)
		}
	}
	return entries
}

func writeBackEntries(manifest map[string]any, entries []map[string]any) {
	list := make([]any, 0, len(entries))
	for _, entry := range entries {
		list = append(list, entry)
	}
	manifest["条目"] = list
}

func findAssetEntry(manifest map[string]any, id string) map[string]any {
	for _, entry := range manifestEntries(manifest) {
		if entryString(entry, "编号") == id {
			return entry
		}
	}
	return nil
}

// UpsertAssetEntry 登记/更新清单条目：优先按编号、其次按稳定键合并；未传字段沿用旧值，避免同步规划时覆盖已确认版本。
func UpsertAssetEntry(title string, entry map[string]any) (map[string]any, error) {
	if entry == nil {
		return nil, errors.New("条目为空")
	}
	category := entryString(entry, "分类")
	if !containsString(AssetCategories, category) {
		return nil, fmt.Errorf("分类非法：%s，可选：%s", category, strings.Join(AssetCategories, "/"))
	}
	if name := entryString(entry, "名称"); name == "" {
		return nil, errors.New("名称必填")
	}
	if status := entryString(entry, "状态"); status != "" && !containsString(AssetStatuses, status) {
		return nil, fmt.Errorf("状态非法：%s，可选：%s", status, strings.Join(AssetStatuses, "/"))
	}
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	entries := manifestEntries(manifest)
	id := entryString(entry, "编号")
	key := entryString(entry, "键")
	if key != "" {
		for _, old := range entries {
			if entryString(old, "键") == key && id != "" && entryString(old, "编号") != id {
				return nil, fmt.Errorf("资产稳定键已被占用：%s", key)
			}
		}
	}
	existingIndex := -1
	for i, old := range entries {
		if (id != "" && entryString(old, "编号") == id) || (id == "" && key != "" && entryString(old, "键") == key) {
			existingIndex = i
			break
		}
	}
	if existingIndex >= 0 {
		old := entries[existingIndex]
		merged := map[string]any{}
		for field, value := range old {
			merged[field] = value
		}
		for field, value := range entry {
			merged[field] = value
		}
		merged["编号"] = entryString(old, "编号")
		merged["更新"] = nowStamp()
		entry = merged
		entries[existingIndex] = merged
	} else {
		if id == "" {
			id = fmt.Sprintf("a%03d", len(entries)+1)
			entry["编号"] = id
		}
		if entryString(entry, "状态") == "" {
			entry["状态"] = "待产出"
		}
		entry["更新"] = nowStamp()
		entries = append(entries, entry)
	}
	writeBackEntries(manifest, entries)
	if err := saveAssetManifest(title, manifest); err != nil {
		return nil, err
	}
	return entry, nil
}

// ReviewAssetEntry 审核登记：已确认→状态已确认；需修改→带意见退回待产出。轮次自增留档。
func ReviewAssetEntry(title, id, reviewer, conclusion, comment string) (map[string]any, error) {
	if conclusion != "已确认" && conclusion != "需修改" {
		return nil, errors.New("结论只能为 已确认 或 需修改")
	}
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	entry := findAssetEntry(manifest, id)
	if entry == nil {
		return nil, errors.New("条目不存在：" + id)
	}
	reviews, _ := entry["审核"].([]any)
	record := map[string]any{"轮次": len(reviews) + 1, "审核人": reviewer, "结论": conclusion, "意见": comment, "时间": nowStamp()}
	entry["审核"] = append(reviews, record)
	if conclusion == "已确认" {
		entry["状态"] = "已确认"
	} else {
		entry["状态"] = "待产出"
	}
	entry["更新"] = nowStamp()
	if err := saveAssetManifest(title, manifest); err != nil {
		return nil, err
	}
	return entry, nil
}

func entryDir(title string, entry map[string]any) (string, error) {
	dir, err := assetProjectDir(title)
	if err != nil {
		return "", err
	}
	name := strings.ReplaceAll(entryString(entry, "名称"), "/", "_")
	return filepath.Join(dir, "资产", entryString(entry, "分类"), name), nil
}

func nextVersion(entry map[string]any) string {
	current := entryString(entry, "当前版本")
	n := 0
	if strings.HasPrefix(current, "v") {
		n, _ = strconv.Atoi(current[1:])
	}
	return fmt.Sprintf("v%03d", n+1)
}

// BindAssetFiles 绑定生成产物为新版本：旧当前版文件移入 history/，新文件带 _vNNN 落条目目录，
// 状态置待审核；sourceJSON 为可复跑源参数（提示词/尺寸/种子/渠道）。
func BindAssetFiles(title, id string, files map[string][]byte, sourceJSON []byte, note string) (map[string]any, error) {
	if len(files) == 0 {
		return nil, errors.New("没有绑定文件")
	}
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	entry := findAssetEntry(manifest, id)
	if entry == nil {
		return nil, errors.New("条目不存在：" + id)
	}
	dir, err := entryDir(title, entry)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return nil, err
	}
	// 旧当前版移入历史区
	current := entryString(entry, "当前版本")
	if current != "" {
		historyDir := filepath.Join(dir, "history", current)
		if err := os.MkdirAll(historyDir, 0o755); err != nil {
			return nil, err
		}
		for _, version := range entryVersions(entry) {
			if entryString(version, "版本") != current {
				continue
			}
			moved := []any{}
			for _, rel := range entryList(version, "文件") {
				relStr, _ := rel.(string)
				base := filepath.Base(filepath.FromSlash(relStr))
				src := filepath.Join(dir, base)
				if _, err := os.Stat(src); err == nil {
					_ = os.Rename(src, filepath.Join(historyDir, base))
					moved = append(moved, filepath.ToSlash(filepath.Join("history", current, base)))
				}
			}
			version["文件"] = moved
			version["状态"] = "已归档"
		}
	}
	version := nextVersion(entry)
	relFiles := []any{}
	for filename, data := range files {
		ext := filepath.Ext(filename)
		base := strings.TrimSuffix(filename, ext)
		name := fmt.Sprintf("%s_%s%s", base, version, ext)
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return nil, err
		}
		relFiles = append(relFiles, filepath.ToSlash(filepath.Join("资产", entryString(entry, "分类"), strings.ReplaceAll(entryString(entry, "名称"), "/", "_"), name)))
	}
	versionRecord := map[string]any{"版本": version, "状态": "当前", "文件": relFiles, "时间": nowStamp(), "备注": note}
	if len(sourceJSON) > 0 {
		sourceName := "source_" + version + ".json"
		if err := os.WriteFile(filepath.Join(dir, sourceName), sourceJSON, 0o644); err != nil {
			return nil, err
		}
		versionRecord["源"] = filepath.ToSlash(filepath.Join("资产", entryString(entry, "分类"), strings.ReplaceAll(entryString(entry, "名称"), "/", "_"), sourceName))
	}
	entry["版本"] = append(entryVersions(entry), versionRecord)
	entry["当前版本"] = version
	entry["状态"] = "待审核"
	entry["更新"] = nowStamp()
	if err := saveAssetManifest(title, manifest); err != nil {
		return nil, err
	}
	return entry, nil
}

func entryVersions(entry map[string]any) []map[string]any {
	raw, _ := entry["版本"].([]any)
	versions := make([]map[string]any, 0, len(raw))
	for _, item := range raw {
		if version, ok := item.(map[string]any); ok {
			versions = append(versions, version)
		}
	}
	return versions
}

// UpsertEpisodeBoard 写入/更新某集分集分镜（按 集 合并进清单 分集 数组）。
func UpsertEpisodeBoard(title string, board map[string]any) (map[string]any, error) {
	ep := entryString(board, "集")
	if ep == "" {
		return nil, errors.New("集号必填")
	}
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	raw, _ := manifest["分集"].([]any)
	boards := make([]any, 0, len(raw)+1)
	replaced := false
	for _, item := range raw {
		if old, ok := item.(map[string]any); ok && entryString(old, "集") == ep {
			boards = append(boards, board)
			replaced = true
			continue
		}
		boards = append(boards, item)
	}
	if !replaced {
		boards = append(boards, board)
	}
	manifest["分集"] = boards
	if err := saveAssetManifest(title, manifest); err != nil {
		return nil, err
	}
	return board, nil
}

// WriteAssetProjectFile 写项目文件夹受控路径（分镜稿 md、导出表等文本或二进制）。
func WriteAssetProjectFile(title, rel string, data []byte) error {
	p, err := assetRelPath(rel)
	if err != nil {
		return err
	}
	dir, err := assetProjectDir(title)
	if err != nil {
		return err
	}
	target := filepath.Join(dir, p)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, data, 0o644)
}

func anyStrings(value any) []string {
	raw, _ := value.([]any)
	result := make([]string, 0, len(raw))
	for _, item := range raw {
		if text, ok := item.(string); ok && strings.TrimSpace(text) != "" {
			result = append(result, strings.TrimSpace(text))
		}
	}
	return result
}

func currentAssetFiles(entry map[string]any) []string {
	current := entryString(entry, "当前版本")
	for _, version := range entryVersions(entry) {
		if entryString(version, "版本") == current {
			return anyStrings(version["文件"])
		}
	}
	return nil
}

func episodeBoard(manifest map[string]any, episode string) map[string]any {
	for _, item := range entryList(manifest, "分集") {
		if board, ok := item.(map[string]any); ok && entryString(board, "集") == episode {
			return board
		}
	}
	return nil
}

func anyInt(value any) int {
	switch number := value.(type) {
	case float64:
		return int(number)
	case int:
		return number
	case json.Number:
		result, _ := number.Int64()
		return int(result)
	}
	return 0
}

// CheckEpisodeAssets 开工前逐镜检查：原文证据、连续性字段、资产引用、版本文件与依赖必须全部可解析。
func CheckEpisodeAssets(title, episode string) (map[string]any, error) {
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	entries := manifestEntries(manifest)
	statusByID := map[string]string{}
	entryByID := map[string]map[string]any{}
	for _, entry := range entries {
		id := entryString(entry, "编号")
		statusByID[id] = entryString(entry, "状态")
		entryByID[id] = entry
	}
	board := episodeBoard(manifest, episode)
	if board == nil {
		return nil, errors.New("分集不存在：" + episode)
	}
	missing, unconfirmed, blocked := []any{}, []any{}, []any{}
	undefinedRefs, missingFiles, emptyShots, incompleteShots := []any{}, []any{}, []any{}, []any{}
	coverageIssues := []any{}
	coverage := entryList(board, "原文覆盖")
	validShotNumbers := map[int]bool{}
	for _, item := range entryList(board, "镜头") {
		if shot, ok := item.(map[string]any); ok {
			validShotNumbers[anyInt(shot["镜号"])] = true
		}
	}
	if len(coverage) == 0 {
		coverageIssues = append(coverageIssues, map[string]any{"序号": 0, "原因": "原文覆盖台账为空"})
	}
	for index, item := range coverage {
		record, ok := item.(map[string]any)
		if !ok || entryString(record, "原文") == "" || entryString(record, "去向") == "" {
			coverageIssues = append(coverageIssues, map[string]any{"序号": index + 1, "原因": "缺少原文或去向"})
			continue
		}
		if entryString(record, "去向") == "暂不采用" && entryString(record, "说明") == "" {
			coverageIssues = append(coverageIssues, map[string]any{"序号": index + 1, "原因": "暂不采用但未说明原因"})
		} else if entryString(record, "去向") != "暂不采用" {
			raw, ok := record["镜号"].([]any)
			if !ok || len(raw) == 0 {
				coverageIssues = append(coverageIssues, map[string]any{"序号": index + 1, "原因": "没有对应镜号"})
				continue
			}
			for _, number := range raw {
				if !validShotNumbers[anyInt(number)] {
					coverageIssues = append(coverageIssues, map[string]any{"序号": index + 1, "原因": "引用了不存在的镜号"})
					break
				}
			}
		}
	}
	seenMissing, seenUnconfirmed, seenBlocked := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, item := range entryList(board, "镜头") {
		shot, ok := item.(map[string]any)
		if !ok {
			continue
		}
		shotNumber := anyInt(shot["镜号"])
		missingFields := []string{}
		for _, field := range []string{"原文证据", "场景", "叙事时点", "镜头职责", "起始状态", "结束状态", "连续性", "出图提示词", "图生视频提示词", "质检标准"} {
			if entryString(shot, field) == "" {
				missingFields = append(missingFields, field)
			}
		}
		if _, exists := shot["出场角色"]; !exists {
			missingFields = append(missingFields, "出场角色（空镜也需显式为空数组）")
		}
		if len(missingFields) > 0 {
			incompleteShots = append(incompleteShots, map[string]any{"镜号": shotNumber, "缺少": missingFields})
		}
		refs := entryList(shot, "资产引用")
		if len(refs) == 0 {
			for _, id := range anyStrings(shot["所需资产"]) {
				refs = append(refs, map[string]any{"编号": id})
			}
		}
		if len(refs) == 0 {
			emptyShots = append(emptyShots, shotNumber)
			continue
		}
		for _, rawRef := range refs {
			ref, ok := rawRef.(map[string]any)
			if !ok {
				continue
			}
			id := entryString(ref, "编号")
			entry := entryByID[id]
			if entry == nil {
				undefinedRefs = append(undefinedRefs, map[string]any{"镜号": shotNumber, "编号": id})
				continue
			}
			status := entryString(entry, "状态")
			if status == "待产出" && !seenMissing[id] {
				missing = append(missing, entry)
				seenMissing[id] = true
			} else if status != "已确认" && !seenUnconfirmed[id] {
				unconfirmed = append(unconfirmed, entry)
				seenUnconfirmed[id] = true
			}
			files := currentAssetFiles(entry)
			selectors := anyStrings(ref["文件"])
			if len(files) == 0 {
				missingFiles = append(missingFiles, map[string]any{"镜号": shotNumber, "编号": id, "原因": "当前版本没有文件"})
			} else if len(files) > 1 && len(selectors) == 0 {
				missingFiles = append(missingFiles, map[string]any{"镜号": shotNumber, "编号": id, "原因": "多文件资产未选择本镜文件"})
			} else {
				filesToCheck := files
				if len(selectors) > 0 {
					filesToCheck = nil
				}
				for _, selector := range selectors {
					matched := false
					for _, file := range files {
						if strings.Contains(strings.ToLower(file), strings.ToLower(selector)) {
							matched = true
							filesToCheck = append(filesToCheck, file)
							break
						}
					}
					if !matched {
						missingFiles = append(missingFiles, map[string]any{"镜号": shotNumber, "编号": id, "原因": "未找到指定文件：" + selector})
					}
				}
				for _, file := range filesToCheck {
					if _, err := AssetFileAbs(title, file); err != nil {
						missingFiles = append(missingFiles, map[string]any{"镜号": shotNumber, "编号": id, "原因": err.Error()})
					}
				}
			}
			for _, depID := range anyStrings(entry["依赖"]) {
				if statusByID[depID] != "已确认" {
					key := id + "\x00" + depID
					if !seenBlocked[key] {
						blocked = append(blocked, map[string]any{"条目": entryString(entry, "名称"), "依赖": depID, "依赖状态": statusByID[depID]})
						seenBlocked[key] = true
					}
				}
			}
		}
	}
	ready := len(missing) == 0 && len(unconfirmed) == 0 && len(blocked) == 0 && len(undefinedRefs) == 0 && len(missingFiles) == 0 && len(emptyShots) == 0 && len(incompleteShots) == 0 && len(coverageIssues) == 0
	return map[string]any{"集": episode, "缺产出": missing, "未确认": unconfirmed, "依赖阻塞": blocked, "未定义引用": undefinedRefs, "缺少文件": missingFiles, "空资产镜头": emptyShots, "字段不完整镜头": incompleteShots, "覆盖台账问题": coverageIssues, "可开工": ready}, nil
}

// AssetFileAbs 返回项目文件夹受控路径的绝对路径（供流式下发缩略图/文件）。
func AssetFileAbs(title, rel string) (string, error) {
	p, err := assetRelPath(rel)
	if err != nil {
		return "", err
	}
	dir, err := assetProjectDir(title)
	if err != nil {
		return "", err
	}
	target := filepath.Join(dir, p)
	if _, err := os.Stat(target); err != nil {
		return "", errors.New("文件不存在：" + rel)
	}
	return target, nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}
