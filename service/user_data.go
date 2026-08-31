package service

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strings"

	"github.com/tigerowo/infinite-canvas/model"
	"github.com/tigerowo/infinite-canvas/repository"
)

type UserConfigPayload struct {
	ModelConfig      json.RawMessage       `json:"modelConfig,omitempty"`
	StorageProvider  *UserStorageProviders `json:"storageProvider,omitempty"`
	ImageHistory     json.RawMessage       `json:"imageHistory,omitempty"`
	AssetData        json.RawMessage       `json:"assetData,omitempty"`
	SyncCapabilities map[string]bool       `json:"syncCapabilities,omitempty"`
}

type StorageObjectProviderInput struct {
	Enabled         *bool  `json:"enabled,omitempty"`
	Name            string `json:"name"`
	Type            string `json:"type"`
	Endpoint        string `json:"endpoint"`
	Region          string `json:"region"`
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"accessKeyId"`
	SecretAccessKey string `json:"secretAccessKey"`
	PublicBaseURL   string `json:"publicBaseUrl"`
	PathPrefix      string `json:"pathPrefix"`
	Username        string `json:"username"`
	Password        string `json:"password"`
}

type UserStorageProviders struct {
	S3     *StorageObjectProviderInput `json:"s3,omitempty"`
	WebDAV *StorageObjectProviderInput `json:"webdav,omitempty"`
}

type userModelConfigInput struct {
	LocalChannels []userLocalModelChannelInput `json:"localChannels"`
}

type userLocalModelChannelInput struct {
	ID       string   `json:"id"`
	Protocol string   `json:"protocol"`
	Name     string   `json:"name"`
	BaseURL  string   `json:"baseUrl"`
	APIKey   string   `json:"apiKey"`
	Models   []string `json:"models"`
}

func SelectUserLocalModelChannelForModel(userID string, modelName string, channelID string) (model.ModelChannel, error) {
	userID = strings.TrimSpace(userID)
	modelName = strings.TrimSpace(modelName)
	channelID = strings.TrimSpace(channelID)
	if userID == "" {
		return model.ModelChannel{}, errors.New("请先登录")
	}
	if modelName == "" {
		return model.ModelChannel{}, errors.New("缺少模型名称")
	}
	if channelID == "" {
		return model.ModelChannel{}, errors.New("缺少模型渠道")
	}
	config, ok, err := repository.GetUserConfig(userID)
	if err != nil {
		return model.ModelChannel{}, err
	}
	if !ok || strings.TrimSpace(config.ModelConfig) == "" {
		return model.ModelChannel{}, errors.New("本地渠道不存在")
	}
	var modelConfig userModelConfigInput
	if err := json.Unmarshal([]byte(config.ModelConfig), &modelConfig); err != nil {
		return model.ModelChannel{}, err
	}
	for _, channel := range modelConfig.LocalChannels {
		if strings.TrimSpace(channel.ID) != channelID {
			continue
		}
		baseURL := strings.TrimSpace(channel.BaseURL)
		apiKey := strings.TrimSpace(channel.APIKey)
		if baseURL == "" || apiKey == "" {
			return model.ModelChannel{}, errors.New("本地渠道配置不完整")
		}
		models := userLocalChannelModels(channel.Models)
		if len(models) > 0 && !userLocalChannelHasModel(models, modelName) && !userLocalDashScopeCompanionModel(channel.Protocol, modelName) {
			return model.ModelChannel{}, errors.New("本地渠道不支持该模型")
		}
		protocol := strings.ToLower(strings.TrimSpace(channel.Protocol))
		if protocol == "" {
			protocol = "openai"
		}
		return model.ModelChannel{
			ID:       channelID,
			Protocol: protocol,
			Name:     firstVideoTaskValue(strings.TrimSpace(channel.Name), "本地直连"),
			BaseURL:  baseURL,
			APIKey:   apiKey,
			Models:   models,
			Weight:   1,
			Timeout:  600,
			Enabled:  true,
		}, nil
	}
	return model.ModelChannel{}, errors.New("本地渠道不存在")
}

func userLocalChannelModels(models []string) []string {
	result := make([]string, 0, len(models))
	seen := map[string]bool{}
	for _, item := range models {
		modelName := strings.TrimSpace(item)
		if modelName == "" || seen[modelName] {
			continue
		}
		result = append(result, modelName)
		seen[modelName] = true
	}
	return result
}

func userLocalChannelHasModel(models []string, modelName string) bool {
	for _, item := range models {
		if strings.EqualFold(strings.TrimSpace(item), modelName) {
			return true
		}
	}
	return false
}

// userLocalDashScopeCompanionModel 百炼渠道的伴随模型放行：带参考图编辑由前端固定改用 qwen-image-edit-plus，
// 该模型不需要用户逐一列入渠道模型白名单，否则会被「本地渠道不支持该模型」拦截
func userLocalDashScopeCompanionModel(protocol string, modelName string) bool {
	return strings.EqualFold(strings.TrimSpace(protocol), ModelChannelProtocolDashScope) &&
		strings.EqualFold(strings.TrimSpace(modelName), DashScopeImageEditModel)
}

// UserLocalChannelAPIKeyForURL 查找目标 URL 对应的本地渠道凭证：仅当目标 host 与某渠道 baseUrl 的 host
// 精确匹配时返回该渠道 apiKey，否则报错，避免把渠道凭证发给无关主机。
func UserLocalChannelAPIKeyForURL(ctx context.Context, targetURL string) (string, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return "", errors.New("请先登录")
	}
	config, found, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return "", err
	}
	if !found || strings.TrimSpace(config.ModelConfig) == "" {
		return "", errors.New("本地渠道不存在")
	}
	var modelConfig userModelConfigInput
	if err := json.Unmarshal([]byte(config.ModelConfig), &modelConfig); err != nil {
		return "", errors.New("本地渠道配置格式错误")
	}
	target, err := url.Parse(targetURL)
	if err != nil || target.Host == "" {
		return "", errors.New("无效的 url")
	}
	for _, channel := range modelConfig.LocalChannels {
		baseURL := strings.TrimSpace(channel.BaseURL)
		apiKey := strings.TrimSpace(channel.APIKey)
		if baseURL == "" || apiKey == "" {
			continue
		}
		parsed, err := url.Parse(baseURL)
		if err != nil || parsed.Host == "" {
			continue
		}
		if parsed.Host == target.Host {
			return apiKey, nil
		}
	}
	return "", errors.New("目标地址与本地渠道不匹配")
}

func CurrentUserConfig(ctx context.Context) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	config, ok, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return UserConfigPayload{}, err
	}
	result := UserConfigPayload{
		SyncCapabilities: map[string]bool{
			"userData":  true,
			"workflows": true,
			"assets":    true,
		},
	}
	if !ok {
		return result, nil
	}
	if strings.TrimSpace(config.ModelConfig) != "" {
		result.ModelConfig = json.RawMessage(config.ModelConfig)
	}
	if strings.TrimSpace(config.StorageProvider) != "" {
		providers := readUserStorageProviders(config.StorageProvider)
		var syncFlags struct {
			SyncStorageConfig       bool `json:"syncStorageConfig"`
			SyncWebDAVStorageConfig bool `json:"syncWebDAVStorageConfig"`
		}
		_ = json.Unmarshal(result.ModelConfig, &syncFlags)
		if !syncFlags.SyncStorageConfig {
			providers.S3 = nil
		}
		if !syncFlags.SyncWebDAVStorageConfig {
			providers.WebDAV = nil
		}
		if providers.S3 != nil || providers.WebDAV != nil {
			result.StorageProvider = &providers
		}
	}
	if strings.TrimSpace(config.ImageHistory) != "" {
		result.ImageHistory = json.RawMessage(config.ImageHistory)
	}
	if strings.TrimSpace(config.AssetData) != "" {
		result.AssetData = json.RawMessage(config.AssetData)
	}
	return result, nil
}

func readUserStorageProviders(raw string) UserStorageProviders {
	var providers UserStorageProviders
	if strings.TrimSpace(raw) != "" {
		_ = json.Unmarshal([]byte(raw), &providers)
	}
	return providers
}

func SaveCurrentUserModelConfig(ctx context.Context, raw json.RawMessage) (UserConfigPayload, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return UserConfigPayload{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return UserConfigPayload{}, err
	}
	current := now()
	if config.UserID == "" {
		config.UserID = user.ID
		config.CreatedAt = current
	}
	config.ModelConfig = string(raw)
	config.UpdatedAt = current
	if _, err := repository.SaveUserConfig(config); err != nil {
		return UserConfigPayload{}, err
	}
	return CurrentUserConfig(ctx)
}

func CurrentUserImageHistory(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.ImageHistory) == "" {
		return json.RawMessage(`{"logs":[],"categories":[]}`), nil
	}
	return json.RawMessage(config.ImageHistory), nil
}

func SaveCurrentUserImageHistory(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	config, err := saveCurrentUserConfigField(ctx, func(config *model.UserConfig) {
		config.ImageHistory = string(raw)
	})
	if err != nil {
		return nil, err
	}
	return json.RawMessage(config.ImageHistory), nil
}

func CurrentUserAssetData(ctx context.Context) (json.RawMessage, error) {
	config, err := currentUserConfig(ctx)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(config.AssetData) == "" {
		return json.RawMessage(`{"assets":[]}`), nil
	}
	return json.RawMessage(config.AssetData), nil
}

func SaveCurrentUserAssetData(ctx context.Context, raw json.RawMessage) (json.RawMessage, error) {
	config, err := saveCurrentUserConfigField(ctx, func(config *model.UserConfig) {
		config.AssetData = string(raw)
	})
	if err != nil {
		return nil, err
	}
	return json.RawMessage(config.AssetData), nil
}

func currentUserConfig(ctx context.Context) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return model.UserConfig{}, err
	}
	if config.UserID == "" {
		config.UserID = user.ID
	}
	return config, nil
}

func saveCurrentUserConfigField(ctx context.Context, patch func(config *model.UserConfig)) (model.UserConfig, error) {
	user, ok := UserFromContext(ctx)
	if !ok || user.ID == "" {
		return model.UserConfig{}, errors.New("请先登录")
	}
	config, _, err := repository.GetUserConfig(user.ID)
	if err != nil {
		return model.UserConfig{}, err
	}
	current := now()
	if config.UserID == "" {
		config.UserID = user.ID
		config.CreatedAt = current
	}
	patch(&config)
	config.UpdatedAt = current
	return repository.SaveUserConfig(config)
}
