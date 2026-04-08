"""normalize usda nutrition to per serving

Revision ID: e5eb2c3dd359
Revises: 672dc8858775
Create Date: 2026-04-08 00:00:00.000000

Previously, USDA-estimated nutrition was stored as totals for the whole recipe.
Page-scraped nutrition was always per-serving. This migration divides stored
totals by servings for all usda_estimate recipes so everything is consistent.
"""
from alembic import op
import sqlalchemy as sa

revision = 'e5eb2c3dd359'
down_revision = '672dc8858775'
branch_labels = None
depends_on = None


def upgrade():
    # Only touch recipes that used USDA estimation and have >1 serving stored
    op.execute("""
        UPDATE recipe
        SET calories  = ROUND(calories  / NULLIF(servings, 0), 2),
            protein_g = ROUND(protein_g / NULLIF(servings, 0), 2),
            carbs_g   = ROUND(carbs_g   / NULLIF(servings, 0), 2),
            fat_g     = ROUND(fat_g     / NULLIF(servings, 0), 2)
        WHERE nutrition_source = 'usda_estimate'
          AND (servings IS NULL OR servings > 1)
    """)


def downgrade():
    # Reverse: multiply back by servings
    op.execute("""
        UPDATE recipe
        SET calories  = ROUND(calories  * NULLIF(servings, 0), 2),
            protein_g = ROUND(protein_g * NULLIF(servings, 0), 2),
            carbs_g   = ROUND(carbs_g   * NULLIF(servings, 0), 2),
            fat_g     = ROUND(fat_g     * NULLIF(servings, 0), 2)
        WHERE nutrition_source = 'usda_estimate'
          AND (servings IS NULL OR servings > 1)
    """)
