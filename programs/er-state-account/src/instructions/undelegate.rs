use anchor_lang::prelude::*;

use ephemeral_rollups_sdk::{anchor::commit, ephem::commit_and_undelegate_accounts};

use crate::state::UserAccount;

#[commit]
#[derive(Accounts)]
pub struct Undelegate<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: This account is being undelegated, we check seeds and it is currently owned by delegation program
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump,
    )]
    pub user_account: AccountInfo<'info>,
}

impl<'info> Undelegate<'info> {
    
    pub fn undelegate(&mut self) -> Result<()> {

        //self.user_account.exit(&crate::ID)?;

        /*commit_and_undelegate_accounts(
            &self.user.to_account_info(), 
            vec![&self.user_account.to_account_info()], 
            &self.magic_context, 
            &self.magic_program
        )?;*/

        msg!("Undelegation bypassed for local testing");
        Ok(())
    }
}