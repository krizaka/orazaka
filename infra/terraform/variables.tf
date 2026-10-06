variable "aws_region" {
  type        = string
  description = "The AWS region to deploy core services to"
  default     = "us-east-1"
}

variable "vpc_cidr" {
  type        = string
  description = "VPC Classless Inter-Domain Routing range"
  default     = "10.0.0.0/16"
}

variable "environment" {
  type        = string
  description = "Deployment environment name (e.g. prod, staging, dev)"
  default     = "prod"
}

variable "availability_zones" {
  type        = list(string)
  description = "Target availability zones for subnets"
  default     = ["us-east-1a", "us-east-1b"]
}

variable "db_username" {
  type        = string
  description = "PostgreSQL administrator username"
}

variable "db_password" {
  type        = string
  description = "PostgreSQL administrator password"
  sensitive   = true
}

variable "rabbitmq_username" {
  type        = string
  description = "RabbitMQ cluster administrator username"
  default     = "orazaka_admin"
}

variable "rabbitmq_password" {
  type        = string
  description = "RabbitMQ cluster administrator password"
  sensitive   = true
}

variable "google_client_id" {
  type        = string
  description = "OAuth2 Google client identifier"
}

variable "google_client_secret" {
  type        = string
  description = "OAuth2 Google client secret"
  sensitive   = true
}

variable "github_client_id" {
  type        = string
  description = "OAuth2 GitHub client identifier"
}

variable "github_client_secret" {
  type        = string
  description = "OAuth2 GitHub client secret"
  sensitive   = true
}

variable "nextauth_secret" {
  type        = string
  description = "JWT encryption secret for NextAuth"
  sensitive   = true
}

variable "runpod_api_key" {
  type        = string
  description = "RunPod API Access token key"
  sensitive   = true
}

variable "runpod_gpu_type" {
  type        = string
  description = "Target GPU instance type for RunPod worker"
  default     = "NVIDIA A100-SXM4-80GB"
}

variable "runpod_min_replicas" {
  type        = number
  description = "Minimum running serverless GPU workers on RunPod"
  default     = 0
}

variable "runpod_max_replicas" {
  type        = number
  description = "Maximum running serverless GPU workers on RunPod"
  default     = 10
}

variable "runpod_container_image" {
  type        = string
  description = "Target Docker image for RunPod workers"
  default     = "orazaka/runpod-worker-ltx:latest"
}

variable "modal_api_token_id" {
  type        = string
  description = "Modal token identifier"
  sensitive   = true
}

variable "modal_api_token_secret" {
  type        = string
  description = "Modal token secret"
  sensitive   = true
}

variable "automation_worker_image" {
  type        = string
  description = "Docker image URI for the orazaka-automation-worker Fargate sidecar"
  default     = "orazaka/automation-worker:latest"
}
