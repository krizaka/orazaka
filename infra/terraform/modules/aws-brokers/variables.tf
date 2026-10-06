variable "vpc_id" {
  type = string
}

variable "private_subnet_ids" {
  type = list(string)
}

variable "environment" {
  type = string
}

variable "db_username" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "db_name" {
  type = string
}

variable "pg_vector_enabled" {
  type = bool
}

variable "redis_node_type" {
  type = string
}

variable "rabbitmq_instance_type" {
  type = string
}

variable "rabbitmq_username" {
  type = string
}

variable "rabbitmq_password" {
  type      = string
  sensitive = true
}
