"""user-scoped menu/goals/shopping, recipe ratings table

Revision ID: 94ef266fffc7
Revises: fb0b3e1d2eb0
Create Date: 2026-04-07 23:58:58.146036

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '94ef266fffc7'
down_revision = 'fb0b3e1d2eb0'
branch_labels = None
depends_on = None


def upgrade():
    # Table may already exist if db.create_all() ran before this migration
    from sqlalchemy import inspect
    bind = op.get_bind()
    if 'recipe_rating' not in inspect(bind).get_table_names():
        op.create_table(
            'recipe_rating',
            sa.Column('user_id',   sa.Integer(), nullable=False),
            sa.Column('recipe_id', sa.Integer(), nullable=False),
            sa.Column('rating',    sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(['user_id'],   ['user.id'],   name='fk_recipe_rating_user'),
            sa.ForeignKeyConstraint(['recipe_id'], ['recipe.id'], name='fk_recipe_rating_recipe'),
            sa.PrimaryKeyConstraint('user_id', 'recipe_id'),
        )

    with op.batch_alter_table('custom_shopping_item', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_csi_user', 'user', ['user_id'], ['id'])

    with op.batch_alter_table('diet_goal', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_diet_goal_user', 'user', ['user_id'], ['id'])

    with op.batch_alter_table('menu_entry', schema=None) as batch_op:
        batch_op.add_column(sa.Column('user_id', sa.Integer(), nullable=True))
        batch_op.create_foreign_key('fk_menu_entry_user', 'user', ['user_id'], ['id'])

    with op.batch_alter_table('recipe', schema=None) as batch_op:
        batch_op.drop_column('rating')


def downgrade():
    with op.batch_alter_table('recipe', schema=None) as batch_op:
        batch_op.add_column(sa.Column('rating', sa.INTEGER(), nullable=True))

    with op.batch_alter_table('menu_entry', schema=None) as batch_op:
        batch_op.drop_constraint('fk_menu_entry_user', type_='foreignkey')
        batch_op.drop_column('user_id')

    with op.batch_alter_table('diet_goal', schema=None) as batch_op:
        batch_op.drop_constraint('fk_diet_goal_user', type_='foreignkey')
        batch_op.drop_column('user_id')

    with op.batch_alter_table('custom_shopping_item', schema=None) as batch_op:
        batch_op.drop_constraint('fk_csi_user', type_='foreignkey')
        batch_op.drop_column('user_id')

    op.drop_table('recipe_rating')
