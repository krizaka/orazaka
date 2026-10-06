resource "aws_vpc" "main" {
  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name        = "orazaka-vpc-${var.environment}"
    Environment = var.environment
  }
}

resource "aws_subnet" "public_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 10)
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "orazaka-public-1"
  }
}

resource "aws_subnet" "public_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 11)
  availability_zone = var.availability_zones[1]

  tags = {
    Name = "orazaka-public-2"
  }
}

resource "aws_subnet" "private_1" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 20)
  availability_zone = var.availability_zones[0]

  tags = {
    Name = "orazaka-private-1"
  }
}

resource "aws_subnet" "private_2" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, 21)
  availability_zone = var.availability_zones[1]

  tags = {
    Name = "orazaka-private-2"
  }
}
