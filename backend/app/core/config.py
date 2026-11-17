from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    APP_NAME: str = "OHB Polio Campaign Management System (OPCMS)"
    API_V1_PREFIX: str = "/api/v1"
    DATABASE_URL: str = (
        "postgresql+psycopg2://opcms_user:CHANGE_ME_STRONG_PASSWORD@localhost:5432/opcms_db"
    )
    JWT_SECRET_KEY: str = "CHANGE_ME_DEV_SECRET_KEY"
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 480
    CORS_ORIGINS: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origin_list(self) -> List[str]:
        return [origin.strip() for origin in self.CORS_ORIGINS.split(",") if origin.strip()]

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
