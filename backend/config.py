# Configuration for Supabase and Flask
import os
from datetime import timedelta
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.getenv(
    "SUPABASE_URL",
    "https://hsnlgbtiakdcjydvgkzj.supabase.co/"
)
SUPABASE_ANON_KEY = os.getenv(
    "SUPABASE_ANON_KEY",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzbmxnYnRpYWtkY2p5ZHZna3pqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQyNzA5ODUsImV4cCI6MjA4OTg0Njk4NX0.AE2svfQHqKtvhiVVk2sX1nDvMGAd8xJmCqJa4QPDkgo"
)

# Flask Configuration
FLASK_ENV = os.getenv("FLASK_ENV", "development")
DEBUG = FLASK_ENV == "development"
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")

# CORS Configuration - Support both localhost and production domains
DEFAULT_CORS_ORIGINS = [
    "http://localhost:8000",
    "http://localhost:8080",
    "http://localhost:3000",
    "http://127.0.0.1:8000",
    "http://127.0.0.1:8080",
    "http://127.0.0.1:3000",
]

CORS_ORIGINS_ENV = os.getenv("CORS_ORIGINS", "")
CORS_ORIGINS = (
    [origin.strip() for origin in CORS_ORIGINS_ENV.split(",") if origin.strip()]
    if CORS_ORIGINS_ENV
    else DEFAULT_CORS_ORIGINS
)

# Session Configuration
PERMANENT_SESSION_LIFETIME = timedelta(days=7)
SESSION_COOKIE_SECURE = not DEBUG  # Enforce HTTPS in production
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
