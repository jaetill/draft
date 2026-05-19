variable "project_name" {
  type    = string
  default = "draft"
}

variable "env" {
  type    = string
  default = "prod"
}

variable "aws_region" {
  type    = string
  default = "us-east-2"
}

variable "aws_account_id" {
  type    = string
  default = "214599503944"
}

variable "cloudfront_acm_cert_arn" {
  type    = string
  default = "arn:aws:acm:us-east-1:214599503944:certificate/ac71c7d9-5a8a-4597-a08c-f1b6bf7d58eb"
}