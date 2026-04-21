import time

from fastapi import APIRouter

router = APIRouter()
_BOOT = time.time()


@router.get("/health")
async def health() -> dict:
    try:
        import scrapling  # type: ignore
        scrapling_version = getattr(scrapling, "__version__", "unknown")
    except Exception:
        scrapling_version = "unavailable"
    return {
        "ok": True,
        "version": "1.0.0",
        "scrapling_version": scrapling_version,
        "uptime_s": round(time.time() - _BOOT, 2),
    }
