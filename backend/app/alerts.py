import os, boto3
from datetime import datetime, timezone, timedelta

TABLE = boto3.resource("dynamodb").Table(os.environ["TABLE_NAME"])
SNS = boto3.client("sns")

def lambda_handler(event, context):
    now = datetime.now(timezone.utc)
    soon, oldest = now + timedelta(minutes=30), (now - timedelta(days=2)).isoformat()
    sent = 0
    for row in TABLE.scan().get("Items", []):
        if row.get("createdAt", "") < oldest:
            continue
        lines = []
        for s in row.get("streams", []):
            if s.get("status") == "pending" and not s.get("alerted"):
                dl = datetime.fromisoformat(s["deadline"])
                if dl <= soon:
                    state = "has passed" if dl <= now else "is within 30 minutes"
                    lines.append(f"{s['label']} ({s['kg']} kg): deadline {state}. Send to: {s['destination']}. If missed: {s['reroute']}.")
                    s["alerted"] = True
        if lines:
            SNS.publish(TopicArn=os.environ["TOPIC_ARN"], Subject="MessLoop: waste deadline",
                        Message="\n".join(lines) + "\n\nOpen MessLoop and mark each stream as handed over.")
            TABLE.put_item(Item=row)
            sent += 1
    return {"alerts": sent}
