resource "aws_db_subnet_group" "db_subnets" {
  name       = "orazaka-db-subnet-group-${var.environment}"
  subnet_ids = var.private_subnet_ids

  tags = {
    Name = "orazaka-db-subnet-group"
  }
}

resource "aws_db_instance" "postgres" {
  allocated_storage      = 20
  engine                 = "postgres"
  engine_version         = "15"
  instance_class         = "db.t4g.micro"
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.db_subnets.name
  skip_final_snapshot    = true
}

resource "aws_elasticache_subnet_group" "redis_subnets" {
  name       = "orazaka-redis-subnet-group-${var.environment}"
  subnet_ids = var.private_subnet_ids
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "orazaka-redis-${var.environment}"
  engine               = "redis"
  node_type            = var.redis_node_type
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  subnet_group_name    = aws_elasticache_subnet_group.redis_subnets.name
  port                 = 6379
}

# AWS MQ RabbitMQ Placeholder
resource "null_resource" "rabbitmq_setup" {
  triggers = {
    instance_type = var.rabbitmq_instance_type
    username      = var.rabbitmq_username
  }
}
