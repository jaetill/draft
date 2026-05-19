resource "aws_secretsmanager_secret" "github_token" {
  name        = "draft/github-token"
  description = "GitHub PAT for feedback Lambda to file user-feedback issues on jaetill/draft"
}