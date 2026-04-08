"""add weight tracking

Revision ID: 5c8540efddaa
Revises: e5eb2c3dd359
Create Date: 2026-04-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

revision = '5c8540efddaa'
down_revision = 'e5eb2c3dd359'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    inspector = Inspector.from_engine(bind)
    existing_tables = inspector.get_table_names()

    if 'weight_entry' not in existing_tables:
        op.create_table(
            'weight_entry',
            sa.Column('id',         sa.Integer(),  nullable=False),
            sa.Column('user_id',    sa.Integer(),  nullable=False),
            sa.Column('date',       sa.Date(),     nullable=False),
            sa.Column('weight',     sa.Float(),    nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['user.id'], name='fk_we_user'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('user_id', 'date', name='uq_we_user_date'),
        )

    # Add goal_weight to diet_goal if not present
    diet_goal_cols = [c['name'] for c in inspector.get_columns('diet_goal')]
    if 'goal_weight' not in diet_goal_cols:
        op.add_column('diet_goal',
            sa.Column('goal_weight', sa.Float(), nullable=True))


def downgrade():
    op.drop_column('diet_goal', 'goal_weight')
    op.drop_table('weight_entry')
