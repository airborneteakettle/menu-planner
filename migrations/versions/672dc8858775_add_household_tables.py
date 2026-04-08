"""add household tables

Revision ID: 672dc8858775
Revises: 94ef266fffc7
Create Date: 2026-04-08 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.engine.reflection import Inspector

# revision identifiers, used by Alembic.
revision = '672dc8858775'
down_revision = '94ef266fffc7'
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    existing = Inspector.from_engine(bind).get_table_names()

    if 'household' not in existing:
        op.create_table(
            'household',
            sa.Column('id',         sa.Integer(),     nullable=False),
            sa.Column('name',       sa.String(100),   nullable=True),
            sa.Column('created_by', sa.Integer(),     nullable=True),
            sa.Column('created_at', sa.DateTime(),    nullable=True),
            sa.ForeignKeyConstraint(['created_by'], ['user.id'],
                                    name='fk_household_created_by'),
            sa.PrimaryKeyConstraint('id'),
        )

    if 'household_member' not in existing:
        op.create_table(
            'household_member',
            sa.Column('household_id', sa.Integer(), nullable=False),
            sa.Column('user_id',      sa.Integer(), nullable=False),
            sa.Column('joined_at',    sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['household_id'], ['household.id'],
                                    name='fk_hm_household'),
            sa.ForeignKeyConstraint(['user_id'], ['user.id'],
                                    name='fk_hm_user'),
            sa.PrimaryKeyConstraint('household_id', 'user_id'),
        )


def downgrade():
    op.drop_table('household_member')
    op.drop_table('household')
