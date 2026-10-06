resource "aws_ecs_cluster" "main" {
  name = "orazaka-ecs-cluster-${var.environment}"
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "orazaka-backend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "512"
  memory                   = "1024"

  container_definitions = jsonencode([
    {
      name      = "orazaka-backend"
      image     = "orazaka/backend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 8080
          hostPort      = 8080
        }
      ]
      environment = [
        { name = "SPRING_DATASOURCE_URL", value = var.db_connection_url },
        { name = "SPRING_DATASOURCE_USERNAME", value = var.db_username },
        { name = "SPRING_DATASOURCE_PASSWORD", value = var.db_password },
        { name = "REDIS_URL", value = var.redis_url },
        { name = "SPRING_RABBITMQ_HOST", value = var.rabbitmq_host },
        { name = "SPRING_RABBITMQ_USERNAME", value = var.rabbitmq_username },
        { name = "SPRING_RABBITMQ_PASSWORD", value = var.rabbitmq_password },
        { name = "CLOUD_LOAD_BALANCER_URL", value = var.cloud_load_balancer_url },
        { name = "MODAL_LOAD_BALANCER_URL", value = var.modal_load_balancer_url },
        { name = "GOOGLE_CLIENT_ID", value = var.google_client_id },
        { name = "GOOGLE_CLIENT_SECRET", value = var.google_client_secret },
        { name = "GITHUB_CLIENT_ID", value = var.github_client_id },
        { name = "GITHUB_CLIENT_SECRET", value = var.github_client_secret }
      ]
    }
  ])
}

resource "aws_ecs_task_definition" "frontend" {
  family                   = "orazaka-frontend"
  network_mode             = "awsvpc"
  requires_compatibilities = ["FARGATE"]
  cpu                      = "256"
  memory                   = "512"

  container_definitions = jsonencode([
    {
      name      = "orazaka-frontend"
      image     = "orazaka/frontend:latest"
      essential = true
      portMappings = [
        {
          containerPort = 3000
          hostPort      = 3000
        }
      ]
      environment = [
        { name = "GATEWAY_URL", value = "http://orazaka-backend.local:8080" },
        { name = "NEXTAUTH_URL", value = "https://app.orazaka.io" },
        { name = "NEXTAUTH_SECRET", value = var.nextauth_secret }
      ]
    }
  ])
}

# ECS Services setup templates
resource "null_resource" "ecs_services" {
  triggers = {
    cluster_id   = aws_ecs_cluster.main.id
    backend_task = aws_ecs_task_definition.backend.arn
    frontend_task = aws_ecs_task_definition.frontend.arn
  }
}
