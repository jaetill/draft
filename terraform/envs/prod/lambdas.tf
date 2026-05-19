resource "aws_lambda_function" "feedback" {
  function_name = "draft-feedback"
  role          = aws_iam_role.feedback.arn
  handler       = "feedback.handler"
  runtime       = "nodejs22.x"
  architectures = ["x86_64"]
  memory_size   = 256
  timeout       = 10

  filename = "${path.module}/placeholder.zip"

  environment {
    variables = {
      GITHUB_REPO_OWNER = "jaetill"
      GITHUB_REPO_NAME  = "draft"
      GITHUB_SECRET_ID  = "draft/github-token"
      DEPLOY_ENV        = "production"
      LOG_LEVEL         = "INFO"
    }
  }

  lifecycle {
    ignore_changes = [filename, source_code_hash]
  }
}