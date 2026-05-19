terraform {
  required_version = ">= 1.6"

  backend "s3" {
    bucket         = "jaetill-tfstate"
    key            = "draft/prod/terraform.tfstate"
    region         = "us-east-2"
    encrypt        = true
    dynamodb_table = "terraform-state-lock"
  }
}