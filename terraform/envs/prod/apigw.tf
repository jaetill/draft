# Phase 7: HTTP API exclusively for feedback (draft has no other Lambdas yet).

resource "aws_apigatewayv2_api" "feedback" {
  name                       = "draft-feedback-api"
  protocol_type              = "HTTP"
  route_selection_expression = "$request.method $request.path"

  cors_configuration {
    allow_origins = ["https://draft.jaetill.com", "http://localhost:5173"]
    allow_methods = ["POST", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 86400
  }
}

resource "aws_apigatewayv2_stage" "feedback_default" {
  api_id      = aws_apigatewayv2_api.feedback.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_apigatewayv2_integration" "feedback" {
  api_id                 = aws_apigatewayv2_api.feedback.id
  integration_type       = "AWS_PROXY"
  integration_method     = "POST"
  integration_uri        = aws_lambda_function.feedback.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "feedback_post" {
  api_id    = aws_apigatewayv2_api.feedback.id
  route_key = "POST /feedback"
  target    = "integrations/${aws_apigatewayv2_integration.feedback.id}"
}

resource "aws_lambda_permission" "apigw_feedback" {
  statement_id  = "apigw-feedback"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.feedback.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.feedback.execution_arn}/*/*"
}

output "feedback_api_url" {
  value       = aws_apigatewayv2_api.feedback.api_endpoint
  description = "Base URL for the feedback API. Set VITE_FEEDBACK_API_URL to this in CI."
}