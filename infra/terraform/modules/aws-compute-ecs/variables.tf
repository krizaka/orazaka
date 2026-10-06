variable "vpc_id" {
  type = string
}

variable "public_subnet_ids" {
  type = list(string)
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "environment" {
  type = string
}

variable "db_connection_url" {
  type = string
}

variable "db_username" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "redis_url" {
  type = string
}

variable "rabbitmq_host" {
  type = string
}

variable "rabbitmq_username" {
  type = string
}

variable "rabbitmq_password" {
  type      = string
  sensitive = true
}

variable "cloud_load_balancer_url" {
  type = string
}

variable "modal_load_balancer_url" {
  type = string
}

variable "google_client_id" {
  type = string
}

variable "google_client_secret" {
  type      = string
  sensitive = true
}

variable "github_client_id" {
  type = string
}

variable "github_client_secret" {
  type      = string
  sensitive = true
}

variable "nextauth_secret" {
  type      = string
  sensitive = true
}
