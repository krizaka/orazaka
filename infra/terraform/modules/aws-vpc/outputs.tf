output "vpc_id" {
  value       = aws_vpc.main.id
  description = "The ID of the provisioned VPC"
}

output "public_subnet_ids" {
  value       = [aws_subnet.public_1.id, aws_subnet.public_2.id]
  description = "List of public subnet IDs"
}

output "private_subnet_ids" {
  value       = [aws_subnet.private_1.id, aws_subnet.private_2.id]
  description = "List of private subnet IDs"
}
