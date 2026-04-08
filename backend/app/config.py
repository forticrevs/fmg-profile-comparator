from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    fmg_host: str = ""
    fmg_username: str = ""
    fmg_password: str = ""
    fmg_adom: str = "root"
    fmg_verify_ssl: bool = False

    model_config = SettingsConfigDict(
        env_file=(
            Path(__file__).resolve().parents[1] / ".env",
            Path.cwd() / ".env",
        ),
        env_prefix="FMG_",
        extra="ignore",
    )


settings = Settings()
