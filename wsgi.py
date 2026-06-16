"""wsgi.py — Entry point for Gunicorn and local dev."""

import os
from dotenv import load_dotenv

load_dotenv()  # load .env before importing app

from app import create_app

application = create_app()
app = application   # alias for gunicorn: `gunicorn wsgi:app`

if __name__ == "__main__":
    debug = os.environ.get("FLASK_DEBUG", "0") == "1"
    application.run(host="0.0.0.0", port=5000, debug=debug)
