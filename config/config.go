package config

import (
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"strings"

	"github.com/caarlos0/env/v11"
	"github.com/joho/godotenv"
)

type Config struct {
	Port                string `env:"PORT" envDefault:"8080"`
	AdminUsername       string `env:"ADMIN_USERNAME" envDefault:"admin"`
	AdminPassword       string `env:"ADMIN_PASSWORD" envDefault:"infinite-canvas"`
	JWTSecret           string `env:"JWT_SECRET" envDefault:"infinite-canvas"`
	JWTExpireHours      int    `env:"JWT_EXPIRE_HOURS" envDefault:"168"`
	StorageDriver       string `env:"STORAGE_DRIVER" envDefault:"sqlite"`
	DatabaseDSN         string `env:"DATABASE_DSN" envDefault:"data/infinite-canvas.db"`
	PublicBaseURL       string `env:"PUBLIC_BASE_URL"`
	LinuxDoAuthorizeURL string `env:"LINUX_DO_AUTHORIZE_URL" envDefault:"https://connect.linux.do/oauth2/authorize"`
	LinuxDoTokenURL     string `env:"LINUX_DO_TOKEN_URL" envDefault:"https://connect.linux.do/oauth2/token"`
	LinuxDoUserInfoURL  string `env:"LINUX_DO_USERINFO_URL" envDefault:"https://connect.linux.do/api/user"`
	AILogDir            string `env:"AI_LOG_DIR" envDefault:"data/logs/ai-calls"`
	FFMPEGPath          string `env:"FFMPEG_PATH"`
	LocalMediaDir       string `env:"LOCAL_MEDIA_DIR" envDefault:"D:/InfiniteCanvas"`
}

var Cfg Config

func Load() error {
	_ = godotenv.Load()
	if err := env.Parse(&Cfg); err != nil {
		return err
	}
	normalizeDockerSQLiteDSN("/app/data")
	if strings.TrimSpace(Cfg.JWTSecret) == "" || Cfg.JWTSecret == "infinite-canvas" {
		secret, err := persistedJWTSecret()
		if err != nil {
			return err
		}
		Cfg.JWTSecret = secret
	}
	return nil
}

// persistedJWTSecret 读取或创建落盘复用的 JWT 密钥（data/.jwt-secret，已在 .gitignore 内）。
// 未显式配置 JWT_SECRET（为空或仍是 .env.example 的占位值）时必须落盘复用：
// 否则每次进程启动都换一个随机密钥，把浏览器里已登录的令牌全部作废——
// 桌面双击形态下重编或重启就会静默登出，资产清单等需登录的接口一律报「未登录或权限不足」。
func persistedJWTSecret() (string, error) {
	const secretFile = "data/.jwt-secret"
	if data, err := os.ReadFile(secretFile); err == nil {
		if secret := strings.TrimSpace(string(data)); secret != "" {
			return secret, nil
		}
	} else if !os.IsNotExist(err) {
		return "", err
	}
	secret, err := randomSecret()
	if err != nil {
		return "", err
	}
	if err := os.MkdirAll(filepath.Dir(secretFile), 0o755); err != nil {
		return "", err
	}
	if err := os.WriteFile(secretFile, []byte(secret), 0o600); err != nil {
		return "", err
	}
	return secret, nil
}

func normalizeDockerSQLiteDSN(appDataDir string) {
	driver := strings.ToLower(strings.TrimSpace(Cfg.StorageDriver))
	if driver != "" && driver != "sqlite" {
		return
	}
	dsn := strings.TrimSpace(Cfg.DatabaseDSN)
	if dsn == "" || dsn == ":memory:" || strings.HasPrefix(dsn, "file:") {
		return
	}
	pathPart, suffix := dsn, ""
	if index := strings.Index(dsn, "?"); index >= 0 {
		pathPart = dsn[:index]
		suffix = dsn[index:]
	}
	if filepath.IsAbs(pathPart) {
		return
	}
	slashPath := filepath.ToSlash(pathPart)
	if slashPath != "data" && !strings.HasPrefix(slashPath, "data/") {
		return
	}
	if _, err := os.Stat(appDataDir); err != nil {
		return
	}
	Cfg.DatabaseDSN = filepath.Join(filepath.Dir(appDataDir), filepath.FromSlash(slashPath)) + suffix
}

func randomSecret() (string, error) {
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(buf), nil
}
