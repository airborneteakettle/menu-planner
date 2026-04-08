"""add shopping_checked_item table

Revision ID: a1b2c3d4e5f6
Revises: 4c95510ff53a
Branch Labels: None
Depends On: None

"""
from alembic import op
import sqlalchemy as sa


revision = 'a1b2c3d4e5f6'
down_revision = '4c95510ff53a'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'shopping_checked_item',
        sa.Column('id',         sa.Integer(),    nullable=False),
        sa.Column('user_id',    sa.Integer(),    nullable=False),
        sa.Column('week_start', sa.String(10),   nullable=False),
        sa.Column('item_key',   sa.String(300),  nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['user.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'week_start', 'item_key',
                            name='uq_shopping_checked'),
    )


def downgrade():
    op.drop_table('shopping_checked_item')
