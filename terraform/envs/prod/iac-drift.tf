# ADR-0035 — read-only OIDC role for the iac-additive-guard.
#
# Plans terraform/envs/prod on PRs (and is available for a future drift
# detector) under a scoped plan policy + tfstate read. Trust gates assume-role
# on this repo's GitHub OIDC for the default branch (master) and pull_request.
# Created out-of-band 2026-06-05 (platform #280) and imported here so it is
# Terraform-managed. Mirrors game-night-pwa's iac_drift role.
#
# The plan policy is scoped to the services tracked in this env
# (S3, CloudFront, IAM, Lambda, API Gateway v2, Secrets Manager).
# secretsmanager:GetSecretValue, ssm:GetParameter*, and s3:GetObject on
# non-tfstate buckets are intentionally absent.

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
      identifiers = ["arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com"]
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

data "aws_iam_policy_document" "iac_drift_plan" {
  # S3 bucket metadata — GetObject is intentionally absent; tfstate reads
  # are handled by the separate iac_drift_tfstate inline policy.
  statement {
    sid    = "S3Describe"
    effect = "Allow"
    actions = [
      "s3:GetBucketAcl",
      "s3:GetBucketCORS",
      "s3:GetBucketLogging",
      "s3:GetBucketObjectLockConfiguration",
      "s3:GetBucketPolicy",
      "s3:GetBucketPolicyStatus",
      "s3:GetBucketPublicAccessBlock",
      "s3:GetBucketRequestPayment",
      "s3:GetBucketTagging",
      "s3:GetBucketVersioning",
      "s3:GetBucketWebsite",
      "s3:ListAllMyBuckets",
      "s3:ListBucket",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "CloudFrontDescribe"
    effect = "Allow"
    actions = [
      "cloudfront:GetDistribution",
      "cloudfront:GetDistributionConfig",
      "cloudfront:GetOriginAccessControl",
      "cloudfront:GetOriginAccessControlConfig",
      "cloudfront:ListDistributions",
      "cloudfront:ListOriginAccessControls",
      "cloudfront:ListTagsForResource",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "IAMDescribe"
    effect = "Allow"
    actions = [
      "iam:GetPolicy",
      "iam:GetPolicyVersion",
      "iam:GetRole",
      "iam:GetRolePolicy",
      "iam:ListAttachedRolePolicies",
      "iam:ListInstanceProfilesForRole",
      "iam:ListRolePolicies",
    ]
    resources = ["*"]
  }

  statement {
    sid    = "LambdaDescribe"
    effect = "Allow"
    actions = [
      "lambda:GetAlias",
      "lambda:GetFunction",
      "lambda:GetFunctionCodeSigningConfig",
      "lambda:GetFunctionConfiguration",
      "lambda:GetPolicy",
      "lambda:ListAliases",
      "lambda:ListVersionsByFunction",
    ]
    resources = ["arn:aws:lambda:${var.aws_region}:${var.aws_account_id}:function:draft-*"]
  }

  statement {
    sid    = "APIGatewayDescribe"
    effect = "Allow"
    actions = ["apigateway:GET"]
    resources = [
      "arn:aws:apigateway:${var.aws_region}::/apis",
      "arn:aws:apigateway:${var.aws_region}::/apis/*",
    ]
  }

  # secretsmanager:ListSecrets requires resource=* per AWS IAM constraints;
  # GetSecretValue is intentionally absent.
  statement {
    sid    = "SecretsManagerDescribe"
    effect = "Allow"
    actions = [
      "secretsmanager:DescribeSecret",
      "secretsmanager:GetResourcePolicy",
      "secretsmanager:ListSecretVersionIds",
    ]
    resources = ["arn:aws:secretsmanager:${var.aws_region}:${var.aws_account_id}:secret:draft/*"]
  }

  statement {
    sid       = "SecretsManagerList"
    effect    = "Allow"
    actions   = ["secretsmanager:ListSecrets"]
    resources = ["*"]
  }
}

resource "aws_iam_role_policy" "iac_drift_plan" {
  name   = "plan-access"
  role   = aws_iam_role.iac_drift.id
  policy = data.aws_iam_policy_document.iac_drift_plan.json
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
    resources = ["arn:aws:dynamodb:${var.aws_region}:${var.aws_account_id}:table/terraform-state-lock"]
  }
}

resource "aws_iam_role_policy" "iac_drift_tfstate" {
  name   = "tfstate-access"
  role   = aws_iam_role.iac_drift.id
  policy = data.aws_iam_policy_document.iac_drift_tfstate.json
}
