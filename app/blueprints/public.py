"""app/blueprints/public.py — Public-facing HTML pages."""

import os
from flask import Blueprint, render_template
from app.db import db_connection

public_bp = Blueprint("public", __name__)


@public_bp.get("/")
def index():
    return render_template("public/index.html")


@public_bp.get("/s/<slug>")
def bracket(slug):
    with db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT slug, display_name, created_at FROM prediction_sessions WHERE slug = %s",
                (slug,),
            )
            session = cur.fetchone()

    if not session:
        return render_template("public/404.html"), 404


    host_url = os.environ.get("HOST_URL", "").rstrip("/")
    import datetime
    s = {}
    for k, v in dict(session).items():
        s[k] = v.isoformat() if isinstance(v, (datetime.datetime, datetime.date)) else v
    return render_template("public/bracket.html", session=s, host_url=host_url)


@public_bp.get("/team/<path:team_name>")
def team_profile(team_name):
    return render_template("public/team.html", team_name=team_name)
