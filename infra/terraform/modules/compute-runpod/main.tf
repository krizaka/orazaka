# RunPod module placeholder. In production, this can use a null_resource to trigger templates setup or runpod custom provider.
resource "null_resource" "runpod_setup" {
  triggers = {
    gpu_type        = var.gpu_type
    container_image = var.container_image
  }
}
