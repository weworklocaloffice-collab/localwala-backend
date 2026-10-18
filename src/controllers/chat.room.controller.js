/**
 * LocalWala – Local Commerce & Delivery Platform
 * (NodeJS, MongoDB, Angular & Flutter)
 *
 * Copyright © 2026 WeWorkLocal Private Limited
 * https://weworklocal.in/
 *
 * WeWorkLocal Private Limited
 *
 * This source code is confidential.
 * Unauthorized copying, redistribution, resale, publication,
 * modification, or use of this source code in any public or
 * commercial repository is strictly prohibited.
 *
 * Ownership Fingerprint:
 * LWL|WWL|2026|LOCALWALA|NODE
 */

const { status: httpStatus } = require('http-status');
const multer = require('multer');
const ExcelJS = require('exceljs');
const Papa = require('papaparse');
const fs = require('fs');
const path = require('path');
const { DateTime } = require('luxon');
const catchAsync = require('../utils/catchAsync');
const pick = require('../utils/pick');
const { chatRoomService, chatConversionService } = require('../services');
const uploadMiddleware = require('../middlewares/upload');
const config = require('../config/config');
const {
  regularChatListSchemaKeys,
  regularChatMessageSchemaKeys,
} = require('../utils/importCollectionSchema');

const checkChatRoom = catchAsync(async (req, res) => {
  const { senderId, receiverId } = req.body;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await chatRoomService.checkChatRoom(senderId, receiverId, options);
  res.send(result);
});

const saveNewMessage = catchAsync(async (req, res) => {
  const { room, sender, msg, msgType } = req.body;
  const result = await chatConversionService.saveNewMessage(room, sender, msg, msgType);
  res.send(result);
});

const getMyConversionList = catchAsync(async (req, res) => {
  const { user } = req.params;
  const result = await chatRoomService.getMyConversionList(user);
  res.send(result);
});

// "FB|RJ|2026|ENVATO|FOODBITE|ECITAW15071997"

const getChatConversion = catchAsync(async (req, res) => {
  const { roomId } = req.body;
  const options = pick(req.body, ['sortBy', 'limit', 'page']);
  const result = await chatConversionService.getMessages(roomId, options);
  res.send(result);
});

const adminChatList = catchAsync(async (req, res) => {
  const options = pick(req.query, ['sortBy', 'limit', 'page']);
  const result = await chatRoomService.adminChatList(options);
  res.send(result);
});

const adminGetChatMessages = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await chatConversionService.adminGetChatMessages(id, options);
  res.send(result);
});

const cityzenChatList = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await chatRoomService.cityzenChatList(id, options);
  res.send(result);
});

const cityzenGetChatMessages = catchAsync(async (req, res) => {
  const { id } = req.params;
  const options = pick(req.query, ['limit', 'page']);
  const result = await chatConversionService.cityzenGetChatMessages(id, options);
  res.send(result);
});

const exportChatListCollection = catchAsync(async (req, res) => {
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await chatRoomService.exportCollection();
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        senderId: detail.senderId ? detail.senderId : '-',
        receiverId: detail.receiverId ? detail.receiverId : '-',
        lastMessage: detail.lastMessage ? detail.lastMessage : '-',
        lastMessageType: detail.lastMessageType ? detail.lastMessageType : 'text',
        senderFirstName:
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        senderLastName:
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
        receiverFirstName:
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        receiverLastName:
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RegularChatList');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Sender Id', key: 'senderId' },
        { header: 'Sender FirstName', key: 'senderFirstName' },
        { header: 'Sender LastName', key: 'senderLastName' },
        { header: 'Receiver Id', key: 'receiverId' },
        { header: 'Receiver FirstName', key: 'receiverFirstName' },
        { header: 'Receiver LastName', key: 'receiverLastName' },
        { header: 'Last Message', key: 'lastMessage' },
        { header: 'Last Message Type', key: 'lastMessageType' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'Sender Id': detail.senderId ? detail.senderId : '-',
        'Sender FirstName':
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        'Sender LastName':
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
        'Receiver Id': detail.receiverId ? detail.receiverId : '-',
        'Receiver FirstName':
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        'Receiver LastName':
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
        'Last Message': detail.lastMessage ? detail.lastMessage : '-',
        'Last Message Type': detail.lastMessageType ? detail.lastMessageType : 'text',
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await chatRoomService.exportRawCollection();
    const downloadPath = path.join(__dirname, `../templates/downloads/regular_chat_list.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'regular_chat_list.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const exportChatMessageCollection = catchAsync(async (req, res) => {
  const { type } = req.query;
  if (type !== 'raw') {
    const result = await chatConversionService.exportCollection();
    if (type === 'excel') {
      const mappedResult = result.map((detail, index) => ({
        ...detail,
        serial: index + 1,
        createdAt: DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
        senderId:
          detail &&
          detail.sender &&
          detail.sender.id &&
          detail.sender.id !== null &&
          detail.sender.id !== ''
            ? detail.sender.id
            : '-',
        senderFirstName:
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        senderLastName:
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
      }));
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('RegularChatMessages');
      worksheet.columns = [
        { header: 'S. No.', key: 'serial' },
        { header: 'Id', key: 'id' },
        { header: 'Room Id', key: 'roomId' },
        { header: 'Sender Id', key: 'senderId' },
        { header: 'Sender FirstName', key: 'senderFirstName' },
        { header: 'Sender LastName', key: 'senderLastName' },
        { header: 'Message', key: 'message' },
        { header: 'Message Type', key: 'messageType' },
        { header: 'Sent On', key: 'createdAt' },
      ];

      worksheet.addRows(mappedResult);

      worksheet.eachRow((row) => {
        row.eachCell((cell) => {
          cell.font = {
            name: 'Verdana',
            size: 12,
            color: { argb: 'FF000000' }, // Black text
          };
          cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }, // White background
          };
        });
      });

      const headerRow = worksheet.getRow(1);

      headerRow.eachCell((cell) => {
        cell.font = {
          name: 'Verdana',
          size: 12,
          bold: true,
          color: { argb: 'FF000000' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true, indent: 3 };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFDCE6F1' }, // Optional
        };
      });

      worksheet.columns.forEach((column) => {
        let maxLength = 0;

        column.eachCell({ includeEmpty: true }, (cell) => {
          let columnLength = 0;

          if (cell.value) {
            const rawValue =
              typeof cell.value === 'object' && cell.value.richText
                ? cell.value.richText.map((rt) => rt.text).join('')
                : cell.value.toString();

            // Account for line breaks and longest line in multi-line cells
            const lines = rawValue.split('\n');
            columnLength = Math.max(...lines.map((line) => line.length));
          }

          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });

        column.width = maxLength + 10; // Add some padding
      });

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename=users.xlsx');

      await workbook.xlsx.write(res);
      res.end();
    } else {
      const fieldItems = result.map((detail, index) => ({
        'S. No.': index + 1,
        Id: detail.id,
        'Room Id': detail.roomId,
        'Sender Id':
          detail &&
          detail.sender &&
          detail.sender.id &&
          detail.sender.id !== null &&
          detail.sender.id !== ''
            ? detail.sender.id
            : '-',
        'Sender FirstName':
          detail &&
          detail.sender &&
          detail.sender.firstName &&
          detail.sender.firstName !== null &&
          detail.sender.firstName !== ''
            ? detail.sender.firstName
            : '-',
        'Sender LastName':
          detail &&
          detail.sender &&
          detail.sender.lastName &&
          detail.sender.lastName !== null &&
          detail.sender.lastName !== ''
            ? detail.sender.lastName
            : '-',
        Message: detail.message,
        'Message Type': detail.messageType,
        'Sent On': DateTime.fromISO(detail.createdAt).toFormat('dd LLL yyyy'),
      }));
      const csv = Papa.unparse(fieldItems);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=users.csv');
      res.send(csv);
    }
  } else {
    const result = await chatConversionService.exportRawCollection();
    const downloadPath = path.join(__dirname, `../templates/downloads/regular_chat_messages.json`);
    fs.writeFileSync(downloadPath, JSON.stringify(result, null, 2));
    res.setHeader('Content-Disposition', 'attachment; filename=export.json');
    res.setHeader('Content-Type', 'application/json');
    if (fs.existsSync(downloadPath)) {
      res.download(downloadPath, 'regular_chat_messages.json', (err) => {
        if (!err) {
          fs.unlink(downloadPath, () => {});
        }
      });
    } else {
      res.status(404).json({ success: false, message: 'File not found', extra: '' });
    }
  }
});

const importChatListCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === regularChatListSchemaKeys.length &&
              importKeys.every((item) => regularChatListSchemaKeys.includes(item));
            if (validSchema) {
              const result = await chatRoomService.importChatListCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === regularChatListSchemaKeys.length &&
                    importKeys.every((item) => regularChatListSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await chatRoomService.importChatListCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

const importChatMessagesCollection = catchAsync(async (req, res) => {
  try {
    const upload = uploadMiddleware('local');
    upload.single('file')(req, res, async (err) => {
      if (!err) {
        if (req.file) {
          const ext = path.extname(req.file.originalname).toLowerCase();
          const { file } = req;
          if (req.body.type === 'excel' && ext === '.xlsx') {
            const workbook = new ExcelJS.Workbook();
            await workbook.xlsx.readFile(file.path);
            const worksheet = workbook.worksheets[0];
            const records = [];
            const headerRow = worksheet.getRow(1).values.slice(1);
            worksheet.eachRow((row, rowNumber) => {
              if (rowNumber === 1) return;

              const rowValues = row.values.slice(1);
              const obj = {};
              headerRow.forEach((header, index) => {
                obj[header] = rowValues[index];
              });

              records.push(obj);
            });
            fs.unlinkSync(file.path);
            const importKeys = [...new Set(records.flatMap(Object.keys))];
            const validSchema =
              importKeys.length === regularChatMessageSchemaKeys.length &&
              importKeys.every((item) => regularChatMessageSchemaKeys.includes(item));
            if (validSchema) {
              const result = await chatRoomService.importChatMessagesCollection(records);
              res.send(result);
            } else {
              res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
            }
          } else if (req.body.type === 'csv' && ext === '.csv') {
            const fileStream = fs.createReadStream(file.path);
            Papa.parse(fileStream, {
              header: true,
              skipEmptyLines: true,
              complete: async (results) => {
                try {
                  const records = results.data;
                  fs.unlinkSync(file.path);
                  const importKeys = [...new Set(records.flatMap(Object.keys))];
                  const validSchema =
                    importKeys.length === regularChatMessageSchemaKeys.length &&
                    importKeys.every((item) => regularChatMessageSchemaKeys.includes(item));
                  if (validSchema) {
                    const result = await chatRoomService.importChatMessagesCollection(records);
                    res.send(result);
                  } else {
                    res.status(400).send({ code: 400, message: 'Validation failed', extra: '' });
                  }
                } catch (papaError) {
                  fs.unlinkSync(file.path);
                  res
                    .status(
                      papaError.statusCode ? papaError.statusCode : httpStatus.INTERNAL_SERVER_ERROR
                    )
                    .send({ code: 400, message: papaError.message, extra: '' });
                }
              },
              error: () => {
                fs.unlinkSync(file.path);
                res.status(500).json({ code: 500, message: 'Failed to parse CSV', extra: '' });
              },
            });
          } else {
            fs.unlinkSync(file.path);
            res.status(400).send({ code: 400, message: 'Invalid file type', extra: '' });
          }
        } else {
          res
            .status(400)
            .send({ code: 400, message: 'Please select a file to upload!', extra: '' });
        }
      } else if (err instanceof multer.MulterError) {
        let { error } = err;
        if (err.code === 'LIMIT_FILE_SIZE') {
          error = `Maximum file size is ##dynamic## MB`;
        }
        const sizeCount = config.file.maxUploadSize / (1024 * 1024);
        res.status(400).send({ code: 400, message: error, extra: sizeCount });
      } else {
        res
          .status(err.statusCode ? err.statusCode : httpStatus.INTERNAL_SERVER_ERROR)
          .send({ code: 400, message: err.message, extra: '' });
      }
    });
  } catch (error) {
    res.status(400).send({ code: 400, message: error.message, extra: '' });
  }
});

module.exports = {
  checkChatRoom,
  saveNewMessage,
  getMyConversionList,
  getChatConversion,
  adminChatList,
  adminGetChatMessages,
  cityzenChatList,
  cityzenGetChatMessages,
  exportChatListCollection,
  exportChatMessageCollection,
  importChatListCollection,
  importChatMessagesCollection,
};

