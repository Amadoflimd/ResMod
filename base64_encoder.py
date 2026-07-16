import base64

# Ask the user for text input
text = input("Enter the text to convert to Base64: ")

# Convert to bytes and then to Base64
encoded_bytes = base64.b64encode(text.encode('utf-8'))
encoded_string = encoded_bytes.decode('utf-8')

print(f"\nOriginal text: {text}")
print(f"Base64: {encoded_string}")
