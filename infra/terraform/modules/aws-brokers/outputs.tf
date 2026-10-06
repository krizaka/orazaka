output "db_endpoint" {
  value       = aws_db_instance.postgres.endpoint
  description = "The PostgreSQL database connection endpoint"
}

output "db_name" {
  value       = aws_db_instance.postgres.db_name
  description = "The database name"
}

output "redis_endpoint" {
  value       = aws_elasticache_cluster.redis.cache_nodes[0].address
  description = "The Redis connection address"
}

output "rabbitmq_host" {
  value       = "orazaka-rabbitmq.mq.us-east-1.amazonaws.com"
  description = "The MQ RabbitMQ broker connection host"
}
