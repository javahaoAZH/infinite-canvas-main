package service

import (
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
// 目录约定：<根目录>/<项目名>/资产清单.json；资产/<分类>/<名称>/；分集/epNN/。
var AssetCategories = []string{"角色", "场景", "道具", "生物", "特效", "图形"}

var AssetStatuses = []string{"待产出", "制作中", "待审核", "需修改", "已确认", "已归档"}

func nowStamp() string { return time.Now().Format("2006-01-02 15:04:05") }

func assetProjectDir(title string) (string, error) {
	folder := sanitizeFolderName(title)
	if folder == "" {
		return "", errors.New("项目名为空")
	}
	return filepath.Join(localMediaBaseDir(), folder), nil
}

// assetRelPath 校验清单内相对路径：只允许 资产/ 与 分集/ 两棵子树，禁越界。
func assetRelPath(rel string) (string, error) {
	p := filepath.ToSlash(strings.TrimSpace(rel))
	if p == "" || strings.Contains(p, "..") {
		return "", errors.New("非法路径")
	}
	if !strings.HasPrefix(p, "资产/") && !strings.HasPrefix(p, "分集/") {
		return "", errors.New("路径必须位于 资产/ 或 分集/ 下")
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
	if err := json.Unmarshal(data, &manifest); err != nil {
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

// UpsertAssetEntry 登记/更新清单条目（按编号合并），校验分类与状态枚举。
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
	if id == "" {
		id = fmt.Sprintf("a%03d", len(entries)+1)
		entry["编号"] = id
	}
	if entryString(entry, "状态") == "" {
		entry["状态"] = "待产出"
	}
	entry["更新"] = nowStamp()
	replaced := false
	for i, old := range entries {
		if entryString(old, "编号") == id {
			entries[i] = entry
			replaced = true
			break
		}
	}
	if !replaced {
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

// CheckEpisodeAssets 开工前检查：该集引用资产的缺产/未确认/依赖阻塞清单。
func CheckEpisodeAssets(title, episode string) (map[string]any, error) {
	manifest, err := LoadAssetManifest(title)
	if err != nil {
		return nil, err
	}
	entries := manifestEntries(manifest)
	statusByID := map[string]string{}
	for _, entry := range entries {
		statusByID[entryString(entry, "编号")] = entryString(entry, "状态")
	}
	missing, unconfirmed, blocked := []any{}, []any{}, []any{}
	for _, entry := range entries {
		used := false
		for _, item := range entryList(entry, "用于") {
			if s, ok := item.(string); ok && strings.HasPrefix(s, episode) {
				used = true
				break
			}
		}
		if !used {
			continue
		}
		status := entryString(entry, "状态")
		if status == "已确认" {
			continue
		}
		if status == "待产出" {
			missing = append(missing, entry)
		} else {
			unconfirmed = append(unconfirmed, entry)
		}
		for _, dep := range entryList(entry, "依赖") {
			if depID, ok := dep.(string); ok && statusByID[depID] != "已确认" {
				blocked = append(blocked, map[string]any{"条目": entryString(entry, "名称"), "依赖": depID, "依赖状态": statusByID[depID]})
			}
		}
	}
	return map[string]any{"集": episode, "缺产出": missing, "未确认": unconfirmed, "依赖阻塞": blocked, "可开工": len(missing) == 0 && len(blocked) == 0}, nil
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
