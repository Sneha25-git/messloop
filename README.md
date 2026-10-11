# MessLoop

**Know what to do with every scrap, and by when.**

MessLoop turns what a hostel mess or canteen throws away into a timed action plan. It splits mixed waste into separate streams, tells staff what to do with each one, where it should go and what to do if the deadline is missed, and logs every batch.

- Live demo: https://main.dclavxiv5avzi.amplifyapp.com/
- Demo video: PASTE-YOUR-YOUTUBE-URL-HERE
- Track: Waste and Energy (WeMakeDevs x AWS, Bharat Builds Tour)

## The problem

Mess kitchens put peels, cooked leftovers, used oil and rice water into one bin. Nobody tells staff what each stream should become or how fast it has to move before it spoils, so usable material is lost and nothing is recorded.

## What it does

- **Waste stream router:** staff describe the waste with quick-add buttons or notes (and optionally a photo). It is split into streams, each with an action, a destination, a fallback route and a live countdown.
- **Donate-or-discard tags:** untouched surplus is flagged safe to donate, cooked leftovers are flagged not for human reuse.
- **Logbook:** every batch is saved with times, destinations and pickup status. CSV export included.
- **Insights:** expected waste per meal, dishes wasted most with a suggested cooking quantity, and charts. These are simple averages from logged data, not a trained model.
- **Deadline alerts:** a scheduled function emails a warning when a stream is close to its deadline.

## Architecture

```
Browser (Amplify Hosting)
   |
   v
API Gateway (HTTP API)
   |
   v
Lambda (Python) ---> DynamoDB (batch log)
   |
   +--> optional photo analysis (Gemini API, free tier)

EventBridge (every 15 min) ---> Lambda (alerts) ---> SNS ---> email
```

## How AWS is used

- **AWS open source:** AWS SAM CLI builds and deploys the whole backend from `backend/template.yaml`.
- **AWS services:** Lambda, API Gateway (HTTP API), DynamoDB, EventBridge, SNS, Amplify Hosting, CloudFormation (through SAM) and CloudShell.

## Project layout

```
backend/    SAM template, Lambda handlers (handler.py, alerts.py) and rules.json
frontend/   Static site (index.html, style.css, app.js, extras.js)
```

## Deploy

```
cd backend
sam build
sam deploy --guided
```

Copy the `ApiUrl` output into `API_URL` at the top of `frontend/app.js`, then host the `frontend` folder (for example with Amplify Hosting).

## Honest limits

- The time windows in `backend/app/rules.json` are placeholders and must be checked against FSSAI and local municipal guidance before real use.
- The demo data is sample batches, not a live pilot yet.
- Photo analysis depends on an optional model key. Without it the app runs in rules-only mode and sorting is driven by the notes.
- The demo API has no authentication.

## Next steps

Validated rules, a real network of composters, biogas units and NGOs, and a pilot in a real mess.

## Author

Built solo by Sneha Sah (team leader and only member).
