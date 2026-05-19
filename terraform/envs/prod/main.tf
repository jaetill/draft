# Production environment for draft. Phase 6 retrofit per ADR-0007.

data "aws_caller_identity" "current" {}
data "aws_region" "current" {}