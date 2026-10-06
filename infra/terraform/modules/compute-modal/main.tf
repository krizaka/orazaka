# Modal module placeholder.
resource "null_resource" "modal_setup" {
  triggers = {
    app_name = var.app_name
  }
}
