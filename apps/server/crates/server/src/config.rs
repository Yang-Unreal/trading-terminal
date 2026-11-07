//! Application configuration loaded from environment variables.

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub app_env: String,
    pub host: String,
    pub port: String,
    pub database_url: String,
    pub cors_origin: Option<String>,
    pub mock_exchange_url: Option<String>,
    pub bitget_ws_proxy: Option<String>,
}

impl Config {
    pub fn from_env() -> Result<Self, String> {
        Self::parse(env::vars())
    }

    pub fn parse<I>(vars: I) -> Result<Self, String>
    where
        I: IntoIterator<Item = (String, String)>,
    {
        let mut map = std::collections::BTreeMap::new();
        for (k, v) in vars {
            map.insert(k, v);
        }
        let app_env = map
            .get("APP_ENV")
            .cloned()
            .unwrap_or_else(|| "development".to_string());
        let database_url = map
            .get("DATABASE_URL")
            .cloned()
            .ok_or_else(|| "DATABASE_URL must be set".to_string())?;
        if database_url.trim().is_empty() {
            return Err("DATABASE_URL must not be empty".to_string());
        }
        let host = map
            .get("HOST")
            .cloned()
            .unwrap_or_else(|| "127.0.0.1".to_string());
        let port = map
            .get("PORT")
            .cloned()
            .unwrap_or_else(|| "3000".to_string());
        let cors_origin = map
            .get("CORS_ORIGIN")
            .cloned()
            .filter(|v| !v.trim().is_empty());

        let mock_exchange_url = parse_optional_url(map.get("MOCK_EXCHANGE_URL"))?;
        let bitget_ws_proxy = parse_proxy(map.get("BITGET_WS_PROXY"))?;

        let cfg = Config {
            app_env,
            host,
            port,
            database_url,
            cors_origin,
            mock_exchange_url,
            bitget_ws_proxy,
        };

        // Production safety checks.
        if cfg.is_production() {
            if cfg.cors_origin.is_none() {
                return Err("CORS_ORIGIN must be set in production".to_string());
            }
            if let Some(o) = &cfg.cors_origin {
                if o.trim() == "*" {
                    return Err("Wildcard CORS origin is not allowed in production".to_string());
                }
            }
            if cfg.mock_exchange_url.is_some() {
                return Err("MOCK_EXCHANGE_URL is not allowed in production".to_string());
            }
            if let Some(proxy) = &cfg.bitget_ws_proxy {
                let lower = proxy.to_lowercase();
                if lower.contains("127.0.0.1")
                    || lower.contains("localhost")
                    || lower.contains("::1")
                    || lower.contains("[::1]")
                {
                    return Err(
                        "BITGET_WS_PROXY local development proxy is not allowed in production"
                            .to_string(),
                    );
                }
            }
        }

        Ok(cfg)
    }

    pub fn is_production(&self) -> bool {
        self.app_env.eq_ignore_ascii_case("production")
    }

    pub fn is_development(&self) -> bool {
        self.app_env.eq_ignore_ascii_case("development")
    }

    pub fn bitget_ws_url(&self) -> String {
        self.mock_exchange_url
            .clone()
            .unwrap_or_else(|| "wss://ws.bitget.com/v2/ws/public".to_string())
    }

    pub fn effective_bitget_ws_proxy(&self) -> Option<String> {
        if self.mock_exchange_url.is_some() {
            None
        } else {
            self.bitget_ws_proxy.clone()
        }
    }

    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

fn parse_optional_url(value: Option<&String>) -> Result<Option<String>, String> {
    Ok(value
        .map(|v| v.trim().to_string())
        .filter(|v| !v.is_empty()))
}

fn parse_proxy(value: Option<&String>) -> Result<Option<String>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }
    let stripped = trimmed
        .strip_prefix("socks5://")
        .or_else(|| trimmed.strip_prefix("socks5h://"))
        .ok_or_else(|| "BITGET_WS_PROXY must use socks5:// or socks5h://".to_string())?;
    let (host, port) = stripped
        .rsplit_once(':')
        .ok_or_else(|| "BITGET_WS_PROXY must include a port".to_string())?;
    if host.is_empty() || port.is_empty() {
        return Err("BITGET_WS_PROXY must include a host and port".to_string());
    }
    port.parse::<u16>()
        .map_err(|_| "BITGET_WS_PROXY port must be a valid number".to_string())?;
    Ok(Some(trimmed.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base_vars() -> Vec<(String, String)> {
        vec![(
            "DATABASE_URL".to_string(),
            "postgres://u:p@localhost/db".to_string(),
        )]
    }

    #[test]
    fn missing_database_url_fails() {
        let res = Config::parse(std::iter::empty::<(String, String)>());
        assert!(res.is_err());
    }

    #[test]
    fn production_requires_cors() {
        let vars = vec![
            ("APP_ENV".to_string(), "production".to_string()),
            (
                "DATABASE_URL".to_string(),
                "postgres://u:p@localhost/db".to_string(),
            ),
        ];
        let res = Config::parse(vars);
        assert!(res.is_err());
    }

    #[test]
    fn development_with_proxy_parses() {
        let mut vars = base_vars();
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "socks5://127.0.0.1:10808".to_string(),
        ));
        let cfg = Config::parse(vars).unwrap();
        assert_eq!(
            cfg.bitget_ws_proxy.as_deref(),
            Some("socks5://127.0.0.1:10808")
        );
        assert_eq!(cfg.bitget_ws_url(), "wss://ws.bitget.com/v2/ws/public");
        assert_eq!(
            cfg.effective_bitget_ws_proxy().as_deref(),
            Some("socks5://127.0.0.1:10808")
        );
    }

    #[test]
    fn development_without_proxy_is_direct() {
        let cfg = Config::parse(base_vars()).unwrap();
        assert!(cfg.bitget_ws_proxy.is_none());
        assert_eq!(cfg.bitget_ws_url(), "wss://ws.bitget.com/v2/ws/public");
        assert!(cfg.effective_bitget_ws_proxy().is_none());
    }

    #[test]
    fn production_without_proxy_is_direct() {
        let mut vars = base_vars();
        vars.push(("APP_ENV".to_string(), "production".to_string()));
        vars.push(("CORS_ORIGIN".to_string(), "https://app.example".to_string()));
        let cfg = Config::parse(vars).unwrap();
        assert!(cfg.bitget_ws_proxy.is_none());
        assert_eq!(cfg.bitget_ws_url(), "wss://ws.bitget.com/v2/ws/public");
    }

    #[test]
    fn production_rejects_local_proxy_ipv4() {
        for proxy in ["socks5://127.0.0.1:10808", "socks5://localhost:10808"] {
            let mut vars = base_vars();
            vars.push(("APP_ENV".to_string(), "production".to_string()));
            vars.push(("CORS_ORIGIN".to_string(), "https://app.example".to_string()));
            vars.push(("BITGET_WS_PROXY".to_string(), proxy.to_string()));
            let err = Config::parse(vars).unwrap_err();
            assert!(err.contains("not allowed in production"));
            assert!(!err.contains("10808"));
        }
    }

    #[test]
    fn production_rejects_local_proxy_ipv6() {
        let mut vars = base_vars();
        vars.push(("APP_ENV".to_string(), "production".to_string()));
        vars.push(("CORS_ORIGIN".to_string(), "https://app.example".to_string()));
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "socks5://[::1]:10808".to_string(),
        ));
        let err = Config::parse(vars).unwrap_err();
        assert!(err.contains("not allowed in production"));
    }

    #[test]
    fn production_rejects_mock_exchange() {
        let mut vars = base_vars();
        vars.push(("APP_ENV".to_string(), "production".to_string()));
        vars.push(("CORS_ORIGIN".to_string(), "https://app.example".to_string()));
        vars.push((
            "MOCK_EXCHANGE_URL".to_string(),
            "ws://127.0.0.1:9001".to_string(),
        ));
        let err = Config::parse(vars).unwrap_err();
        assert!(err.contains("MOCK_EXCHANGE_URL is not allowed in production"));
        assert!(!err.contains("9001"));
    }

    #[test]
    fn mock_exchange_takes_precedence_over_proxy() {
        let mut vars = base_vars();
        vars.push((
            "MOCK_EXCHANGE_URL".to_string(),
            "ws://127.0.0.1:9001".to_string(),
        ));
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "socks5://127.0.0.1:10808".to_string(),
        ));
        let cfg = Config::parse(vars).unwrap();
        assert_eq!(cfg.bitget_ws_url(), "ws://127.0.0.1:9001");
        assert!(cfg.effective_bitget_ws_proxy().is_none());
    }

    #[test]
    fn invalid_proxy_scheme_fails() {
        let mut vars = base_vars();
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "http://127.0.0.1:10808".to_string(),
        ));
        assert!(Config::parse(vars).is_err());
    }

    #[test]
    fn invalid_proxy_uri_fails() {
        let mut vars = base_vars();
        vars.push(("BITGET_WS_PROXY".to_string(), "not-a-uri".to_string()));
        assert!(Config::parse(vars).is_err());
    }

    #[test]
    fn missing_proxy_port_fails() {
        let mut vars = base_vars();
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "socks5://127.0.0.1".to_string(),
        ));
        assert!(Config::parse(vars).is_err());
    }

    #[test]
    fn empty_proxy_is_none() {
        let mut vars = base_vars();
        vars.push(("BITGET_WS_PROXY".to_string(), "   ".to_string()));
        let cfg = Config::parse(vars).unwrap();
        assert!(cfg.bitget_ws_proxy.is_none());
    }

    #[test]
    fn whitespace_proxy_is_trimmed() {
        let mut vars = base_vars();
        vars.push((
            "BITGET_WS_PROXY".to_string(),
            "  socks5://127.0.0.1:10808  ".to_string(),
        ));
        let cfg = Config::parse(vars).unwrap();
        assert_eq!(
            cfg.bitget_ws_proxy.as_deref(),
            Some("socks5://127.0.0.1:10808")
        );
    }
}
