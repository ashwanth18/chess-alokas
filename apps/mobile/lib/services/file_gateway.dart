import 'dart:typed_data';

import 'package:file_picker/file_picker.dart';

import '../models/models.dart';

/// Null means the user cancelled.
typedef ReceiptPicker = Future<PickedReceipt?> Function();

/// Returns whether the file was saved; false means the user cancelled.
typedef CertificateSaver =
    Future<bool> Function(String fileName, Uint8List bytes);

Future<PickedReceipt?> pickReceiptFile() async {
  final file = await FilePicker.pickFile(
    type: FileType.custom,
    allowedExtensions: const ['png', 'jpg', 'jpeg', 'webp', 'pdf'],
  );
  if (file == null) return null;
  final size = await file.length();
  if (size != null && size > ReceiptFile.maxBytes) {
    return PickedReceipt(name: file.name, reportedSize: size);
  }
  return PickedReceipt(
    name: file.name,
    bytes: await file.readAsBytes(),
    reportedSize: size,
  );
}

Future<bool> saveCertificateFile(String fileName, Uint8List bytes) async {
  final saved = await FilePicker.saveFile(
    fileName: fileName,
    bytes: bytes,
    mimeType: 'application/pdf',
  );
  return saved != null;
}
