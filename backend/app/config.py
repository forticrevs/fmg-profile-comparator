from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    fmg_host: str = ""
    fmg_username: str = ""
    fmg_password: str = ""
    fmg_adom: str = "root"
    fmg_verify_ssl: bool = False

    class Config:
        env_file = ".env"
        env_prefix = "FMG_"


settings = Settings()
