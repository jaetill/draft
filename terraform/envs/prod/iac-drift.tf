# ADR-0035 â€” read-only OIDC role for the iac-additive-guard.
#
# Plans terraform/envs/prod on PRs (and is available for a future drift
# detector) under ReadOnlyAccess + tfstate read. Trust gates assume-role on
# this repo's GitHub OIDC for the default branch (master) and pull_request.
# Created out-of-band 2026-06-05 (platform #280) and imported here so it is
# Terraform-managed. Mirrors game-night-pwa's iac_drift role.

resource "aws_iam_role" "iac_drift" {
  name               = "draft-iac-drift"
  assume_role_policy = data.aws_iam_policy_document.iac_drift_trust.json
  description        = "Read-only OIDC role for the ADR-0035 iac-additive-guard (plan PR branches). Trusts master + pull_request."
}

data "aws_iam_policy_document" "iac_drift_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRoleWithWebIdentity"]
    principals {
      type        = "Federated"
      identifiers = ["arn:aws:iam::214599503944:oidc-provider/token.actions.githubusercontent.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:aud"
      values   = ["sts.amazonaws.com"]
    }
    condition {
      test     = "StringEquals"
      variable = "token.actions.githubusercontent.com:sub"
      values = [
        "repo:jaetill/draft:ref:refs/heads/master",
        "repo:jaetill/draft:pull_request",
      ]
    }
  }
}

resource "aws_iam_role_policy_attachment" "iac_drift_read_only" {
  role       = aws_iam_role.iac_drift.name
  policy_arn = "arn:aws:iam::aws:policy/ReadOnlyAccess"
}

data "aws_iam_policy_document" "iac_drift_tfstate" {
  statement {
    sid       = "TFStateRead"
    effect    = "Allow"
    actions   = ["s3:GetObject", "s3:ListBucket"]
    resources = ["arn:aws:s3:::jaetill-tfstate", "arn:aws:s3:::jaetill-tfstate/*"]
  }
  statement {
    sid       = "TFStateLockRead"
    effect    = "Allow"
    actions   = ["dynamodb:GetItem"]
    resources = ["arn:aws:dynamodb:us-east-2:214599503944:table/terraform-state-lock"]
  }
}

resource "aws_iam_role_policy" "iac_drift_tfstate" {
  name   = "tfstate-access"
  role   = aws_iam_role.iac_drift.id
  policy = data.aws_iam_policy_document.iac_drift_tfstate.json
}