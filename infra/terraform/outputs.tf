output "nextjs_app_url" {
  value       = module.aws_compute_ecs.nextjs_app_url
  description = "The public HTTPS URL of the Next.js BFF web application"
}

output "postgres_endpoint" {
  value       = module.aws_brokers.db_endpoint
  description = "PostgreSQL DB connection endpoint address"
}

output "redis_endpoint" {
  value       = module.aws_brokers.redis_endpoint
  description = "Redis Cache Cluster connection endpoint address"
}

output "rabbitmq_endpoint" {
  value       = module.aws_brokers.rabbitmq_host
  description = "RabbitMQ Broker endpoint address"
}

output "runpod_endpoint_url" {
  value       = module.compute_runpod.endpoint_url
  description = "Provisioned RunPod Serverless GPU endpoint URL"
}

output "modal_endpoint_url" {
  value       = module.compute_modal.endpoint_url
  description = "Provisioned Modal Serverless app endpoint URL"
}

output "automation_worker_task_arn" {
  value       = module.aws_compute_ecs.automation_worker_task_arn
  description = "ECS Fargate task definition ARN for the automation worker sidecar"
}
