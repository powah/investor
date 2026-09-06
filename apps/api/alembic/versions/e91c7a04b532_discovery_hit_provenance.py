"""Preserve source-specific Discovery Hit provenance without inventing old metadata."""
from alembic import op
import sqlalchemy as sa

revision = "e91c7a04b532"
down_revision = "d7e3a91b4f20"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("discovery_hits", sa.Column("provenance", sa.JSON(), nullable=False, server_default="{}"))


def downgrade() -> None:
    op.drop_column("discovery_hits", "provenance")
