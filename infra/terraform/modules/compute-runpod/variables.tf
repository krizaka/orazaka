variable "api_key" {
  type      = string
  sensitive = true
}

variable "gpu_type" {
  type = string
}

variable "min_replicas" {
  type = number
}

variable "max_replicas" {
  type = number
}

variable "container_image" {
  type = string
}
