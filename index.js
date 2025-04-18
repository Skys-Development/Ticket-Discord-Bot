require('dotenv').config();
const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, PermissionsBitField } = require('discord.js');
const fs = require('fs');
const config = require('./config.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.User, Partials.GuildMember],
});

const cooldowns = new Map();
let embedMessageID = null;

if (fs.existsSync('./embed.js')) {
  const embedData = require('./embed.js');
  embedMessageID = embedData.embedMessageID;
}

function updatePresence(client) {
  const openTickets = client.guilds.cache.reduce((acc, guild) => {
    return acc + guild.channels.cache.filter(c => c.name.startsWith('ticket-')).size;
  }, 0);

  client.user.setActivity(`${openTickets} Open Tickets`, { type: 4 }); // Custom status
}

client.once('ready', async () => {
  console.log(`${client.user.tag} is online!`);

  client.guilds.cache.forEach(async (guild) => {
    try {
      const embedChannel = await guild.channels.fetch(config.tickets.sendEmbedChannel);
      if (!embedChannel || !embedChannel.isTextBased()) return;

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setLabel('Create Ticket').setStyle(ButtonStyle.Secondary).setCustomId('create_ticket')
      );

      const embed = new EmbedBuilder()
        .setTitle("Open a Ticket")
        .setDescription("Click the button below to create a ticket. Our team will assist you shortly.")
        .setColor("#842abe")
        .setFooter({ text: "Tickets | Powered by William", iconURL: client.user.displayAvatarURL() });

      if (!embedMessageID) {
        const sentMessage = await embedChannel.send({ embeds: [embed], components: [row] });
        embedMessageID = sentMessage.id;
        fs.writeFileSync('./embed.js', `module.exports = { embedMessageID: '${embedMessageID}' };`, 'utf-8');
      } else {
        const existingMessage = await embedChannel.messages.fetch(embedMessageID).catch(() => null);
        if (existingMessage) {
          await existingMessage.edit({ embeds: [embed], components: [row] });
        } else {
          const sentMessage = await embedChannel.send({ embeds: [embed], components: [row] });
          embedMessageID = sentMessage.id;
          fs.writeFileSync('./embed.js', `module.exports = { embedMessageID: '${embedMessageID}' };`, 'utf-8');
        }
      }

    } catch (error) {
      console.error('Error accessing guild channels:', error);
    }
  });

  updatePresence(client);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;
  const userId = interaction.user.id;

  if (interaction.customId === 'create_ticket') {
    const cooldown = cooldowns.get(userId);
    const now = Date.now();
    if (cooldown && cooldown > now) {
      const remaining = Math.ceil((cooldown - now) / 1000);
      const timestamp = `<t:${Math.floor((now + remaining * 1000) / 1000)}:R>`;
      const embed = new EmbedBuilder()
        .setTitle('Please Wait')
        .setDescription(`You have to wait until ${timestamp} before opening another ticket.`)
        .setColor("#ff9900");
      return interaction.reply({ embeds: [embed], flags: 64 });
    }

    const existing = interaction.guild.channels.cache.find(c => c.name === `ticket-${interaction.user.username.toLowerCase()}`);
    if (existing) {
      return interaction.reply({ content: `You already have a ticket open: <#${existing.id}>`, flags: 64 });
    }

    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: config.tickets.category,
      permissionOverwrites: [
        {
          id: interaction.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages],
        },
        {
          id: interaction.guild.id,
          deny: [PermissionsBitField.Flags.ViewChannel],
        },
      ],
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Close").setCustomId("close_ticket").setStyle(ButtonStyle.Primary)
    );

    const embed = new EmbedBuilder()
      .setTitle(`${interaction.user.username}'s Ticket`)
      .setDescription("Please describe your issue and a staff member will be with you shortly.")
      .setColor("#2a043b")
      .setFooter({ text: `User ID: ${interaction.user.id}` });

    ticketChannel.send({
      content: `<@&${config.tickets.staffRole}> New Ticket Created!`,
      embeds: [embed],
      components: [row],
    });

    await interaction.reply({ content: `Ticket created: <#${ticketChannel.id}>`, flags: 64 });

    cooldowns.set(userId, now + 2 * 60 * 60 * 1000);

    updatePresence(client);
  }

  if (interaction.customId === 'close_ticket') {
    const member = await interaction.guild.members.fetch(userId);
    if (!member.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
      return interaction.reply({ content: "You don't have permission to close tickets.", flags: 64 });
    }

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel("Yes, Close Ticket").setCustomId("confirm_close_ticket").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setLabel("No, Cancel").setCustomId("cancel_close_ticket").setStyle(ButtonStyle.Danger)
    );

    await interaction.reply({ content: `Are you sure you want to close this ticket?`, components: [row], flags: 64 });
  }

  if (interaction.customId === 'confirm_close_ticket') {
    await interaction.reply({ content: 'Ticket is closing...', flags: 64 });
    await interaction.channel.delete();
    updatePresence(client);
  }

  if (interaction.customId === 'cancel_close_ticket') {
    await interaction.reply({ content: 'Ticket closure has been canceled.', flags: 64 });
  }
});

client.login(process.env.TOKEN);
