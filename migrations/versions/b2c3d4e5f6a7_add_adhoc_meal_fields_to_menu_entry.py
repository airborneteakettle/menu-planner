"""add adhoc meal fields to menu_entry

Revision ID: b2c3d4e5f6a7
Revises: a1b2c3d4e5f6
Branch Labels: None
Depends On: None

"""
from alembic import op
import sqlalchemy as sa


revision = 'b2c3d4e5f6a7'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('menu_entry', schema=None) as batch_op:
        batch_op.alter_column('recipe_id', existing_type=sa.Integer(), nullable=True)
        batch_op.add_column(sa.Column('adhoc_name',      sa.String(200), nullable=True))
        batch_op.add_column(sa.Column('adhoc_calories',  sa.Float(),     nullable=True))
        batch_op.add_column(sa.Column('adhoc_protein_g', sa.Float(),     nullable=True))
        batch_op.add_column(sa.Column('adhoc_carbs_g',   sa.Float(),     nullable=True))
        batch_op.add_column(sa.Column('adhoc_fat_g',     sa.Float(),     nullable=True))
        batch_op.add_column(sa.Column('adhoc_fiber_g',   sa.Float(),     nullable=True))


def downgrade():
    with op.batch_alter_table('menu_entry', schema=None) as batch_op:
        batch_op.drop_column('adhoc_fiber_g')
        batch_op.drop_column('adhoc_fat_g')
        batch_op.drop_column('adhoc_carbs_g')
        batch_op.drop_column('adhoc_protein_g')
        batch_op.drop_column('adhoc_calories')
        batch_op.drop_column('adhoc_name')
        batch_op.alter_column('recipe_id', existing_type=sa.Integer(), nullable=False)
