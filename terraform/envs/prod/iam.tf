resource "aws_iam_role" "github_deploy" {
  name        = "draft-github-deploy"
  description = "GitHub Actions OIDC deploy role for jaetill/draft"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect    = "Allow"
        Principal = { Federated = "arn:aws:iam::${var.aws_account_id}:oidc-provider/token.actions.githubusercontent.com" }
        Action    = "sts:AssumeRoleWithWebIdentity"
        Condition = {
          StringEquals = {
            "token.actions.githubusercontent.com:aud" = "sts.amazonaws.com"
          }
          StringLike = {
            "token.actions.githubusercontent.com:sub" = ["repo:jaetill/draft:ref:refs/heads/master", "repo:jaetill/draft:environment:production"]
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "github_deploy" {
  name = "draft-github-deploy"
  role = aws_iam_role.github_deploy.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3ListBucket"
        Effect = "Allow"
        Action = ["s3:ListBucket", "s3:GetBucketLocation"]
        Resource = "arn:aws:s3:::jaetill-draft"
      },
      {
        Sid    = "S3SyncObjects"
        Effect = "Allow"
        Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"]
        Resource = "arn:aws:s3:::jaetill-draft/*"
      },
      {
        Sid      = "CloudFrontInvalidate"
        Effect   = "Allow"
        Action   = "cloudfront:CreateInvalidation"
        Resource = "arn:aws:cloudfront::${var.aws_account_id}:distribution/E29VATR5EV095C"
      },
      {
        Sid    = "LambdaUpdateFeedback"
        Effect = "Allow"
        Action = [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
          "lambda:PublishVersion",
        ]
        Resource = aws_lambda_function.feedback.arn
      },
      {
        Sid    = "LambdaAliasProductionOnly"
        Effect = "Allow"
        Action = ["lambda:CreateAlias", "lambda:UpdateAlias"]
        Resource = "${aws_lambda_function.feedback.arn}:production"
      }
    ]
  })
}

# ── feedback Lambda execution role ────────────────────────────────────────

data "aws_iam_policy_document" "lambda_trust" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "feedback" {
  name               = "draft-feedback-role"
  description        = "Execution role for feedback Lambda (Standard 11)"
  assume_role_policy = data.aws_iam_policy_document.lambda_trust.json
}

resource "aws_iam_role_policy_attachment" "feedback_basic_exec" {
  role       = aws_iam_role.feedback.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_iam_role_policy" "feedback_secrets" {
  name = "github-token-access"
  role = aws_iam_role.feedback.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = "secretsmanager:GetSecretValue"
        Resource = aws_secretsmanager_secret.github_token.arn
      }
    ]
  })
}