//! Application configuration loaded from environment variables.

use std::env;

#[derive(Debug, Clone)]
pub struct Config {
    pub app_env: String,
    pub host: String,
    pub port: String,
    pub database_url: String,
    pub cors_origin: Option<String>,
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
        let app_env = map.get("APP_ENV").cloned().unwrap_or_else(|| "development".to_string());
        let database_url = map
            .get("DATABASE_URL")
            .cloned()
            .ok_or_else(|| "DATABASE_URL must be set".to_string())?;
        if database_url.trim().is_empty() {
            return Err("DATABASE_URL must not be empty".to_string());
        }
        let host = map.get("HOST").cloned().unwrap_or_else(|| "127.0.0.1".to_string());
        let port = map.get("PORT").cloned().unwrap_or_else(|| "3000".to_string());
        let cors_origin = map.get("CORS_ORIGIN").cloned().filter(|v| !v.trim().is_empty());

        let cfg = Config { app_env, host, port, database_url, cors_origin };

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
        }

        Ok(cfg)
    }

    pub fn is_production(&self) -> bool {
        self.app_env.eq_ignore_ascii_case("production")
    }

    pub fn is_development(&self) -> bool {
        self.app_env.eq_ignore_ascii_case("development")
    }

    pub fn addr(&self) -> String {
        format!("{}:{}", self.host, self.port)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_database_url_fails() {
        let res = Config::parse(std::iter::empty::<(String, String)>());
        assert!(res.is_err());
    }

    #[test]
    fn production_requires_cors() {
        let vars = vec![
            ("APP_ENV".to_string(), "production".to_string()),
            ("DATABASE_URL".to_string(), "postgres://u:p@localhost/db".to_string()),
        ];
        let res = Config::parse(vars);
        assert!(res.is_err());
    }
}
