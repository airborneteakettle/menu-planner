# Menu Planner

A self-hosted meal planning web app with recipe management, weekly menu planning, shopping list generation, and nutrition tracking powered by the USDA FoodData Central database.

---

## Features

- **Recipe Management** — Import recipes from URLs, create them manually, paste-to-parse ingredient lists, and manage ingredients with section headers (e.g. "Dressing", "Assembly")
- **Menu Planning** — Calendar-based weekly planner; assign recipes to breakfast, lunch, dinner, or snacks
- **Nutrition Tracking** — Per-serving macros (calories, protein, carbs, fat, fiber) with automatic USDA lookup; daily and weekly summaries vs. your diet goals
- **Shopping List** — Aggregates and de-duplicates ingredients across the week's meals by category; supports custom items and per-household checkmarks
- **Diet Goals** — Set target macros and goal weight; progress shown on the dashboard
- **Weight Tracking** — Log weight over time
- **Multi-User Households** — Invite members, share menu entries, and collaborate on a shared shopping list
- **Recipe Ratings** — 1–5 star ratings per user with average displayed on cards
- **Auto-Tagging** — Automatically applies hidden tags (protein type, vegetarian, vegan) based on ingredients
- **Recipe Filtering & Sorting** — Filter by meal type, tag, or rating; sort by calories, protein, carbs, or fat

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3, Flask 3 |
| Database | SQLite via SQLAlchemy + Flask-Migrate (Alembic) |
| Auth | Flask-Login (session-based) |
| Frontend | Vanilla JS SPA, Bootstrap 5 |
| Production server | Gunicorn behind nginx |
| Nutrition data | USDA FoodData Central API |
| Recipe scraping | recipe-scrapers, Browserless.io (optional), ScrapingBee (optional) |
| Email | Resend |

---

## Project Structure

```
menu-planner/
├── app/
│   ├── __init__.py          # App factory, blueprints, middleware
│   ├── models/              # SQLAlchemy models
│   │   ├── user.py          # User, password reset tokens
│   │   ├── recipe.py        # Recipe, Ingredient, Tag, RecipeRating
│   │   ├── menu.py          # MenuEntry, MenuEntryShare
│   │   ├── shopping.py      # CustomShoppingItem, ShoppingCheckedItem
│   │   ├── goals.py         # DietGoal
│   │   ├── household.py     # Household, HouseholdMember
│   │   └── weight.py        # WeightEntry
│   ├── routes/              # Flask blueprints (REST API)
│   │   ├── auth.py          # Login, logout, password reset
│   │   ├── recipes.py       # Recipe CRUD, import, nutrition estimate
│   │   ├── menu.py          # Menu entries, shopping list, sharing
│   │   ├── goals.py         # Diet goal CRUD
│   │   ├── settings.py      # Account settings, USDA refresh
│   │   ├── household.py     # Household management
│   │   ├── users.py         # Peer listing for share dropdowns
│   │   └── weight.py        # Weight logging
│   ├── services/
│   │   ├── usda.py          # USDA API integration, caching, nutrition parsing
│   │   ├── recipe_importer.py  # URL scraping with fallback chain
│   │   ├── shopping.py      # Shopping list aggregation & categorisation
│   │   ├── auto_tags.py     # Hidden tag generation
│   │   └── mail.py          # Resend email integration
│   ├── static/
│   │   ├── css/style.css
│   │   └── js/              # SPA modules (app, recipes, planner, shopping…)
│   └── templates/
│       ├── index.html       # SPA entry point
│       ├── login.html
│       ├── forgot_password.html
│       └── reset_password.html
├── migrations/              # Alembic migration versions
├── scripts/
│   ├── setup_server.sh      # One-time Ubuntu 24.04 server provisioning
│   ├── deploy.sh            # Rolling zero-downtime deployment
│   └── purge_usda_cache.sh  # USDA cache management utility
├── data/                    # SQLite database (git-ignored)
├── tests/
├── config.py
├── run.py                   # Development entry point
└── requirements.txt
```

---

## Local Development Setup

```bash
git clone https://github.com/airborneteakettle/menu-planner.git
cd menu-planner

python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt
```

Create a `.env` file in the project root:

```env
SECRET_KEY=<generate with: python3 -c "import secrets; print(secrets.token_hex(32))">
USDA_API_KEY=DEMO_KEY          # or register free at https://fdc.nal.usda.gov/api-guide.html
RESEND_API_KEY=                # required for password reset emails
MAIL_FROM=you@example.com
BROWSERLESS_API_KEY=           # optional — JS-rendered recipe scraping
SCRAPINGBEE_API_KEY=           # optional — premium scraping fallback
```

Initialise the database and create your first user:

```bash
flask db upgrade
flask create-user <username>
```

Run the development server:

```bash
python run.py
# http://127.0.0.1:5000
```

---

## Production Deployment

### First-time server setup (Ubuntu 24.04)

```bash
chmod +x scripts/setup_server.sh
./scripts/setup_server.sh deploy@<server-ip> <domain.com>
```

This script:
- Installs Python 3, nginx, certbot
- Hardens SSH (key-only auth, no root login)
- Clones the repo to `/opt/menu-planner`
- Creates a virtualenv, runs migrations, creates the first user
- Installs and enables a systemd service
- Configures nginx as a reverse proxy
- Obtains a Let's Encrypt TLS certificate

### Deploying updates

```bash
./scripts/deploy.sh deploy@<server-ip>
```

This does a `git pull`, conditionally installs new packages, runs migrations, and gracefully restarts gunicorn.

---

## Scripts

| Script | Usage |
|--------|-------|
| `scripts/setup_server.sh <user@host> <domain>` | One-time server provisioning |
| `scripts/deploy.sh <user@host>` | Deploy latest changes |
| `scripts/purge_usda_cache.sh` | Purge all USDA cache entries |
| `scripts/purge_usda_cache.sh milk` | Purge search cache for one ingredient |
| `scripts/purge_usda_cache.sh --id 1097512` | Purge portion cache for one fdcId |
| `scripts/purge_usda_cache.sh --no-restart` | Purge without restarting the service |

---

## USDA Nutrition Integration

Nutrition data is fetched from the [USDA FoodData Central API](https://fdc.nal.usda.gov/).

- **Food selection**: Foundation foods are preferred over SR Legacy; results ranked by description match quality
- **Unit conversion**: Volume units (cup, tbsp, tsp) use USDA portion data for accuracy rather than water density
- **Parallel lookups**: Up to 8 concurrent ingredient lookups via `ThreadPoolExecutor`
- **Two-tier cache**: In-memory L1 + SQLite L2 with a 30-day TTL — subsequent lookups for the same ingredient are instant

The `DEMO_KEY` is rate-limited to 30 requests/hour and 50/day. For regular use, register for a free API key at [fdc.nal.usda.gov](https://fdc.nal.usda.gov/api-guide.html).

---

## Monitoring & Troubleshooting

**Request timing** (logged to `app.perf`):
```bash
journalctl -u menu-planner -f | grep app.perf
```

**USDA lookup trace**:
```bash
journalctl -u menu-planner | grep USDA_
```

**USDA cache size**:
```bash
sqlite3 data/menu_planner.db "SELECT COUNT(*), ROUND(SUM(LENGTH(data))/1024.0/1024.0,2) || ' MB' FROM usda_cache;"
```

---

## TODO

### Performance
- [ ] Persist USDA cache warm-up on startup — pre-populate L1 from SQLite so the first request after a restart is fast
- [ ] Investigate gunicorn worker count tuning — currently 2 workers × 2 threads; profile under load

### Nutrition
- [ ] Improve ingredient parsing for multi-word food names (e.g. "heavy cream", "cream cheese")
- [ ] Add support for branded/packaged food lookup (currently Foundation + SR Legacy only)
- [ ] Surface per-ingredient nutrition breakdown in the recipe detail view
- [ ] Add micronutrients (sodium, cholesterol, vitamins) as an optional display toggle

### Recipe Management
- [ ] Recipe scaling — multiply ingredients and nutrition by a factor
- [ ] Duplicate recipe
- [ ] Recipe folders / collections beyond tags
- [ ] Recipe notes / cook log per entry (how it turned out, what to change)
- [ ] Image support — attach a photo to a recipe

### Menu Planner
- [ ] Drag-and-drop reordering of meals within a day
- [ ] Copy a week's plan to the next week
- [ ] "What can I make?" — suggest recipes based on ingredients on hand
- [ ] Meal prep mode — mark meals as prepped, track leftovers across days

### Shopping List
- [ ] Export shopping list to CSV or share via link
- [ ] Aisle/store ordering — let users re-order categories to match their store layout
- [ ] Check-off sync across household members in real-time (currently requires page refresh)

### Household & Sharing
- [ ] Household-level recipe library (recipes visible to all members, not just the creator)
- [ ] Per-member nutrition goals and dashboards

### Infrastructure
- [ ] Automated database backups (nightly `sqlite3 .backup` to object storage)
- [ ] Sentry integration for error monitoring
- [ ] Rate limiting on the `/api/recipes/estimate-nutrition` endpoint
- [ ] Multi-database support (PostgreSQL) for larger households
