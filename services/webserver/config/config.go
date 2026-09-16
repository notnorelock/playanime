package config

import (
	"os"
	"strings"
)

type Config struct {
	Port             string
	Env              string
	BackendURL       string
	ClientDistPath   string
	EnableSourceMaps bool
	// SessionCookieName must match SESSION_COOKIE_NAME on the API — this
	// server reads the same cookie the browser already sends and forwards
	// it verbatim, rather than parsing or verifying it itself.
	SessionCookieName string
	CSP               CSPConfig
}

type CSPConfig struct {
	AllowedScriptHosts  []string
	AllowedConnectHosts []string
	AllowedImageHosts   []string
}

func Load() *Config {
	// Parse CSP hosts from comma-separated strings
	scriptHosts := parseCSV(getEnv("CSP_SCRIPT_HOSTS", "https://www.gstatic.com,http://www.gstatic.com"))
	connectHosts := parseCSV(getEnv("CSP_CONNECT_HOSTS", ""))
	imageHosts := parseCSV(getEnv("CSP_IMAGE_HOSTS", ""))

	return &Config{
		Port:              getEnv("PORT", "3000"),
		Env:               getEnv("ENV", "production"),
		BackendURL:        getEnv("BACKEND_URL", "http://localhost:4000"),
		ClientDistPath:    getEnv("CLIENT_DIST_PATH", "../../packages/web/dist"),
		EnableSourceMaps:  getEnv("ENABLE_SOURCE_MAPS", "true") == "true",
		SessionCookieName: getEnv("SESSION_COOKIE_NAME", "playanime_session"),
		CSP: CSPConfig{
			AllowedScriptHosts:  scriptHosts,
			AllowedConnectHosts: connectHosts,
			AllowedImageHosts:   imageHosts,
		},
	}
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

func parseCSV(csv string) []string {
	if csv == "" {
		return []string{}
	}
	parts := strings.Split(csv, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}
