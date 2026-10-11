import os, re, json, base64, uuid
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import boto3

RULES = json.load(open(os.path.join(os.path.dirname(__file__), "rules.json"), encoding="utf-8"))
TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
MODEL_ID = os.environ.get("MODEL_ID", "").strip()
BEDROCK = boto3.client("bedrock-runtime") if MODEL_ID else None

KEYWORDS = {
    "raw_veg_scraps": ["peel", "scrap", "vegetable", "onion", "potato", "tomato", "stalk", "husk"],
    "cooked_leftovers": ["leftover", "cooked", "rice", "dal", "roti", "curry", "plate"],
    "untouched_surplus": ["surplus", "untouched", "unserved", "extra food"],
    "used_cooking_oil": ["oil"],
    "starchy_water": ["rice water", "dal water", "starch"],
    "greasy_water": ["greasy", "dishwater", "wash water", "waste water", "wastewater"],
    "packaging": ["packet", "packaging", "plastic", "carton", "wrapper", "cardboard"],
}

FOOD = ("cooked_leftovers", "untouched_surplus")

def now(): return datetime.now(timezone.utc)

def num(v):
    try: return float(v or 0)
    except (TypeError, ValueError): return 0.0

ORDER = ["starchy_water", "greasy_water", "used_cooking_oil", "untouched_surplus", "packaging", "cooked_leftovers", "raw_veg_scraps"]

def by_keywords(text):
    t, items = (text or "").lower(), []
    for stream in ORDER:
        for w in KEYWORDS[stream]:
            if w in t:
                m = re.search(r"(\d+(?:\.\d+)?)\s*(?:kg|l|litres?|liters?)?\s*(?:of\s+)?[\w\s]{0,12}" + re.escape(w), t)
                items.append({"name": w, "stream": stream, "kg": float(m.group(1)) if m else 1.0, "confidence": 0.5})
                t = t.replace(w, " ", 1)
                break
    return items

def by_model(text, image_b64, media_type):
    prompt = ("You help a mess manager sort kitchen waste. Study the photo and notes. Return ONLY JSON: "
              '{"items":[{"name":str,"stream":str,"kg":number,"confidence":number}]}. '
              "stream must be one of: " + ", ".join(RULES) + ". kg is a rough estimate. Notes: " + (text or "none"))
    content = [{"text": prompt}]
    if image_b64:
        fmt = "png" if "png" in (media_type or "") else "jpeg"
        content.insert(0, {"image": {"format": fmt, "source": {"bytes": base64.b64decode(image_b64)}}})
    r = BEDROCK.converse(modelId=MODEL_ID, messages=[{"role": "user", "content": content}],
                         inferenceConfig={"maxTokens": 700, "temperature": 0})
    out = r["output"]["message"]["content"][0]["text"]
    items = json.loads(out[out.find("{"): out.rfind("}") + 1]).get("items", [])
    return [i for i in items if i.get("stream") in RULES]

def reply(code, body):
    default = lambda o: float(o) if isinstance(o, Decimal) else str(o)
    return {"statusCode": code, "headers": {"Content-Type": "application/json"}, "body": json.dumps(body, default=default)}

def analyze(event):
    body = json.loads(event.get("body") or "{}")
    text, img = body.get("text", ""), body.get("image_b64")
    mode, note = "rules-only", ""
    items = []
    if BEDROCK and (img or text):
        try:
            items, mode = by_model(text, img, body.get("media_type")), "ai-vision"
        except Exception as e:
            note = "AI model unavailable, used keyword rules instead: " + str(e)[:140]
    if not items:
        items = by_keywords(text)
    grouped = {}
    for i in items:
        g = grouped.setdefault(i["stream"], {"kg": 0.0, "names": [], "conf": []})
        g["kg"] += float(i.get("kg", 1) or 1); g["names"].append(i.get("name", "")); g["conf"].append(float(i.get("confidence", 0.5)))
    meta = {"meal": body.get("meal", ""), "dish": str(body.get("dish") or "").strip()[:60],
            "headcount": int(num(body.get("headcount"))), "cooked_kg": num(body.get("cooked_kg"))}
    streams = []
    for key, g in grouped.items():
        r = RULES[key]
        streams.append({"key": key, "label": r["label"], "icon": r["icon"], "color": r["color"], "kg": round(g["kg"], 1),
                        "items": g["names"], "action": r["action"], "destination": r["destination"], "reroute": r["reroute"],
                        "window_hours": r["window_hours"], "confidence": round(sum(g["conf"]) / len(g["conf"]), 2),
                        "tag": r.get("tag", ""), "status": "pending", "alerted": False,
                        "deadline": (now() + timedelta(hours=r["window_hours"])).isoformat()})
    streams.sort(key=lambda s: s["window_hours"])
    batch = {"batchId": str(uuid.uuid4()), "createdAt": now().isoformat(), "mess": body.get("mess", "My mess"),
             **meta, "mode": mode, "note": note, "windows_verified": False,
             "totalKg": round(sum(s["kg"] for s in streams), 1), "streams": streams}
    TABLE.put_item(Item=json.loads(json.dumps(batch), parse_float=Decimal))
    return reply(200, batch)

def batches():
    rows = TABLE.scan(Limit=200).get("Items", [])
    rows.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return reply(200, {"batches": rows[:50]})

def confirm(event):
    body = json.loads(event.get("body") or "{}")
    item = TABLE.get_item(Key={"batchId": body.get("batchId", "")}).get("Item")
    if not item: return reply(404, {"error": "batch not found"})
    for st in item["streams"]:
        if st["key"] == body.get("key"):
            st["status"], st["doneAt"] = "done", now().isoformat()
    TABLE.put_item(Item=item)
    return reply(200, {"ok": True})

def insights():
    rows = sorted(TABLE.scan().get("Items", []), key=lambda x: x.get("createdAt", ""), reverse=True)
    dishes, meals, by_stream, done, total, kg_total = {}, {}, {}, 0, 0, 0.0
    for r in rows:
        sts = r.get("streams", [])
        wasted = sum(float(s["kg"]) for s in sts if s["key"] in FOOD)
        d = str(r.get("dish") or "").strip().lower()
        if d:
            x = dishes.setdefault(d, {"n": 0, "wasted": 0.0, "cooked": 0.0})
            x["n"] += 1; x["wasted"] += wasted; x["cooked"] += float(r.get("cooked_kg") or 0)
        if r.get("meal"): meals.setdefault(r["meal"], []).append(float(r.get("totalKg") or 0))
        for s in sts:
            by_stream[s["label"]] = round(by_stream.get(s["label"], 0) + float(s["kg"]), 1)
            total += 1; done += 1 if s.get("status") == "done" else 0; kg_total += float(s["kg"])
    forecast = {m: {"kg": round(sum(v[:5]) / len(v[:5]), 1), "n": len(v)} for m, v in meals.items() if len(v) >= 2}
    ranked = []
    for d, x in dishes.items():
        aw, ac = x["wasted"] / x["n"], x["cooked"] / x["n"]
        it = {"dish": d, "n": x["n"], "avg_wasted": round(aw, 1)}
        if x["n"] >= 2 and ac > 0:
            sug = max(0.0, ac - 0.8 * aw)
            it.update({"cook_now": round(ac, 1), "suggest": round(sug, 1), "cut_pct": round(100 * (ac - sug) / ac)})
        ranked.append(it)
    ranked.sort(key=lambda z: z["avg_wasted"], reverse=True)
    return reply(200, {"forecast": forecast, "dishes": ranked[:5], "impact": {
        "batches": len(rows), "kg_total": round(kg_total, 1), "by_stream": by_stream,
        "pickups_done": done, "pickups_total": total}})

def lambda_handler(event, context):
    http = event["requestContext"]["http"]
    try:
        m, p = http["method"], http["path"]
        if m == "POST" and p.endswith("/analyze"): return analyze(event)
        if m == "POST" and p.endswith("/confirm"): return confirm(event)
        if m == "GET" and p.endswith("/batches"): return batches()
        if m == "GET" and p.endswith("/insights"): return insights()
        return reply(404, {"error": "not found"})
    except Exception as e:
        return reply(500, {"error": str(e)})
