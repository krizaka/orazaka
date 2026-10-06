terraform {
  required_version = ">= 1.5.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    runpod = {
      source  = "runpod/runpod"
      version = "~> 1.0"
    }
    modal = {
      source  = "modal-labs/modal"
      version = "~> 0.1"
    }
  }

  backend "s3" {
    bucket         = "orazaka-terraform-state-prod"
    key            = "orazaka/prod/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "orazaka-tf-state-lock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.aws_region
}

provider "runpod" {
  api_key = var.runpod_api_key
}

provider "modal" {
  api_token_id     = var.modal_api_token_id
  api_token_secret = var.modal_api_token_secret
}
