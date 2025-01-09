from PIL import Image

# Load the original image
input_image_path = "./images/icon.png"
output_folder = "./images/"

# Define the sizes needed for Chrome extensions
sizes = [16, 32, 48, 128]

# Open the original image
original_image = Image.open(input_image_path).convert("RGBA")

# Generate and save resized images
for size in sizes:
    resized_image = original_image.resize((size, size))
    resized_image.save(f"{output_folder}icon_{size}x{size}.png", "PNG")

