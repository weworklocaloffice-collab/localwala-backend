const catchAsync = require('../../../utils/catchAsync');
const supportService = require('../services/dairy.support.service');

const createCustomer = catchAsync(async (req, res) => {
  const ticket = await supportService.createTicket({
    requester: req.user._id,
    requesterType: 'customer',
    body: req.body,
  });
  res.status(201).send({ ticket });
});
const listCustomer = catchAsync(async (req, res) => {
  res.send(await supportService.listRequesterTickets({
    requester: req.user._id,
    requesterType: 'customer',
    ...req.query,
  }));
});
const getCustomer = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.getRequesterTicket({
    ticketId: req.params.ticket,
    requester: req.user._id,
    requesterType: 'customer',
  }) });
});
const replyCustomer = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.addRequesterReply({
    ticketId: req.params.ticket,
    requester: req.user._id,
    requesterType: 'customer',
    body: req.body,
  }) });
});

const createPartner = catchAsync(async (req, res) => {
  const ticket = await supportService.createTicket({
    requester: req.user._id,
    requesterType: 'partner',
    businessId: req.outletId,
    body: req.body,
  });
  res.status(201).send({ ticket });
});
const listPartner = catchAsync(async (req, res) => {
  res.send(await supportService.listRequesterTickets({
    requester: req.user._id,
    requesterType: 'partner',
    businessId: req.outletId,
    ...req.query,
  }));
});
const getPartner = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.getRequesterTicket({
    ticketId: req.params.ticket,
    requester: req.user._id,
    requesterType: 'partner',
    businessId: req.outletId,
  }) });
});
const replyPartner = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.addRequesterReply({
    ticketId: req.params.ticket,
    requester: req.user._id,
    requesterType: 'partner',
    businessId: req.outletId,
    body: req.body,
  }) });
});

const listAdmin = catchAsync(async (req, res) => {
  res.send(await supportService.listAdminTickets(req.query));
});
const getAdmin = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.getAdminTicket(req.params.ticket) });
});
const replyAdmin = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.addAdminReply({
    ticketId: req.params.ticket,
    adminId: req.user._id,
    message: req.body.message,
  }) });
});
const updateAdmin = catchAsync(async (req, res) => {
  res.send({ ticket: await supportService.updateAdminTicket({
    ticketId: req.params.ticket,
    adminId: req.user._id,
    body: req.body,
  }) });
});

module.exports = {
  createCustomer, listCustomer, getCustomer, replyCustomer,
  createPartner, listPartner, getPartner, replyPartner,
  listAdmin, getAdmin, replyAdmin, updateAdmin,
};
